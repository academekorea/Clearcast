import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { getSupabaseAdmin } from "./lib/supabase.js";

const CACHE_TTL = 60 * 60 * 1000; // 1 hour — matches hourly rotation
const YT_RE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

function json(data: object, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=120" },
  });
}

function fmtDuration(mins: number | null | undefined): string {
  if (!mins) return "";
  if (mins >= 60) return Math.floor(mins / 60) + "h " + Math.round(mins % 60) + "m";
  return Math.round(mins) + "m";
}

async function fetchArtwork(showName: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(showName)}&media=podcast&limit=1`
    );
    if (!res.ok) return null;
    const d = (await res.json()) as any;
    return d.results?.[0]?.artworkUrl600 || null;
  } catch {
    return null;
  }
}

function rowToHero(row: any, eyeLabel?: string): any {
  const ytMatch = (row.url || "").match(YT_RE);
  const dur = fmtDuration(row.duration_minutes);
  return {
    eye: eyeLabel || "Featured episode",
    title: row.episode_title || row.show_name || "",
    show: row.show_name || "",
    host: (row.show_name || "") + (dur ? " \u00b7 " + dur : ""),
    url: row.url || "",
    ytId: ytMatch ? ytMatch[1] : null,
    artwork: row.artwork || null,
    biasLabel: row.bias_label || "",
    analyzeCount: row.analyze_count || 0,
  };
}

// Pick the best row — prefer YouTube URLs for embed
function pickBest(rows: any[]): any | null {
  if (!rows || !rows.length) return null;
  return rows.find((r: any) => YT_RE.test(r.url || "")) || rows[0];
}

const thirtyDaysAgo = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

// ── Mode handlers ────────────────────────────────────────────────────────────

async function modeTrending(sb: any): Promise<any> {
  const { data } = await sb
    .from("analyses")
    .select("url, show_name, episode_title, bias_score, bias_label, analyze_count, analyzed_at, duration_minutes, show_category")
    .not("bias_score", "is", null)
    .gte("analyzed_at", thirtyDaysAgo())
    .order("analyzed_at", { ascending: false })
    .limit(20);

  // Rotate through top results using hour-based index instead of always picking #1
  const rows = data || [];
  const candidates = rows.slice(0, Math.min(8, rows.length));
  const rotateIdx = candidates.length ? Math.floor(Date.now() / 3600000) % candidates.length : 0;
  const best = candidates.length ? (candidates.find((r: any) => YT_RE.test(r.url || "")) || candidates[rotateIdx]) : null;
  if (!best) return { hero: null, relatedShows: [] };

  if (!best.artwork && !YT_RE.test(best.url || "")) {
    best.artwork = await fetchArtwork(best.show_name);
  }

  // Get related shows from other top entries
  const relatedShows = await buildRelatedFromRows(data || [], best.show_name);

  return { hero: rowToHero(best, "Trending on Podlens"), relatedShows };
}

async function modeCategory(sb: any, category: string): Promise<any> {
  const catLabels: Record<string, string> = {
    news: "News & Politics", tech: "Technology", business: "Business",
    society: "Society & Culture", crime: "True Crime", comedy: "Comedy",
    health: "Health & Science", sports: "Sports",
  };

  const { data } = await sb
    .from("analyses")
    .select("url, show_name, episode_title, bias_score, bias_label, analyze_count, analyzed_at, duration_minutes")
    .ilike("show_category", category)
    .not("bias_score", "is", null)
    .gte("analyzed_at", thirtyDaysAgo())
    .order("analyze_count", { ascending: false })
    .limit(10);

  let rows = data || [];

  // If too few recent results, try all-time
  if (rows.length < 3) {
    const { data: allTime } = await sb
      .from("analyses")
      .select("url, show_name, episode_title, bias_score, bias_label, analyze_count, analyzed_at, duration_minutes")
      .ilike("show_category", category)
      .not("bias_score", "is", null)
      .order("analyze_count", { ascending: false })
      .limit(10);
    if (allTime && allTime.length > rows.length) rows = allTime;
  }

  const best = pickBest(rows);
  if (!best) {
    // Fallback: search iTunes for top shows in this category
    const itunesShows = await searchItunes(category);
    return { hero: null, relatedShows: itunesShows.slice(0, 6) };
  }

  if (!best.artwork && !YT_RE.test(best.url || "")) {
    best.artwork = await fetchArtwork(best.show_name);
  }

  const relatedShows = await buildRelatedFromRows(rows, best.show_name);
  return { hero: rowToHero(best, catLabels[category] || category), relatedShows };
}

async function modeTopic(sb: any, topic: string): Promise<any> {
  // Sanitize topic for ilike — escape % and _
  const safeTopic = topic.replace(/%/g, "").replace(/_/g, "");

  const { data } = await sb
    .from("analyses")
    .select("url, show_name, episode_title, bias_score, bias_label, analyze_count, analyzed_at, duration_minutes, show_category")
    .or(`episode_title.ilike.%${safeTopic}%,show_name.ilike.%${safeTopic}%`)
    .not("bias_score", "is", null)
    .order("analyze_count", { ascending: false })
    .limit(10);

  const rows = data || [];
  const best = pickBest(rows);

  // Always search iTunes for related shows regardless
  const itunesShows = await searchItunes(topic);

  if (best) {
    if (!best.artwork && !YT_RE.test(best.url || "")) {
      best.artwork = await fetchArtwork(best.show_name);
    }
    // Merge Supabase-derived shows with iTunes results
    const sbRelated = await buildRelatedFromRows(rows, best.show_name);
    const merged = dedupeShows([...sbRelated, ...itunesShows]).slice(0, 6);
    return { hero: rowToHero(best, topic), relatedShows: merged };
  }

  // No Supabase match — use first iTunes show as hero placeholder
  if (itunesShows.length) {
    const top = itunesShows[0];
    return {
      hero: {
        eye: topic,
        title: "Top podcast: " + top.name,
        show: top.name,
        host: top.artist || top.name,
        url: top.feedUrl || "",
        ytId: null,
        artwork: top.artwork || null,
        biasLabel: "",
        analyzeCount: 0,
      },
      relatedShows: itunesShows.slice(1, 7),
    };
  }

  return { hero: null, relatedShows: [] };
}

async function modePersonalized(sb: any, userId: string): Promise<any> {
  // 1. Get user interests
  const { data: userData } = await sb
    .from("users")
    .select("interests")
    .eq("id", userId)
    .single();

  // 2. Get top category from analysis history
  const { data: historyData } = await sb
    .from("analyses")
    .select("show_category")
    .eq("user_id", userId)
    .not("show_category", "is", null)
    .order("analyzed_at", { ascending: false })
    .limit(30);

  const catCounts: Record<string, number> = {};
  for (const row of (historyData || []) as any[]) {
    const cat = (row.show_category || "").toLowerCase();
    if (cat) catCounts[cat] = (catCounts[cat] || 0) + 1;
  }
  const topHistoryCat = Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)[0];

  // 3. Check followed shows for recent analyses
  const { data: follows } = await sb
    .from("followed_shows")
    .select("show_name, artwork, feed_url")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(12);

  const followedNames = ((follows || []) as any[]).map((f: any) => f.show_name).filter(Boolean);

  // 4. Try to find a hero from followed shows first
  if (followedNames.length) {
    const { data: followedEps } = await sb
      .from("analyses")
      .select("url, show_name, episode_title, bias_score, bias_label, analyze_count, analyzed_at, duration_minutes, show_category")
      .in("show_name", followedNames)
      .not("bias_score", "is", null)
      .order("analyze_count", { ascending: false })
      .limit(5);

    const best = pickBest(followedEps || []);
    if (best) {
      // Use followed show artwork if available
      const followMatch = ((follows || []) as any[]).find(
        (f: any) => f.show_name === best.show_name
      );
      best.artwork = followMatch?.artwork || await fetchArtwork(best.show_name);

      const relatedShows = await buildRelatedFromFollows(follows || []);
      return { hero: rowToHero(best, "From your shows"), relatedShows };
    }
  }

  // 5. Try top interest category
  const activeCat = topHistoryCat ||
    ((userData?.interests as string[] | null) || [])[0]?.toLowerCase();

  if (activeCat) {
    const result = await modeCategory(sb, activeCat);
    if (result.hero) {
      result.hero.eye = "Based on your interests";
      return result;
    }
  }

  // 6. Fallback to trending
  return modeTrending(sb);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function searchItunes(term: string): Promise<any[]> {
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=podcast&limit=10`
    );
    if (!res.ok) return [];
    const d = (await res.json()) as any;
    return ((d.results || []) as any[])
      .filter((r: any) => r.collectionName)
      .map((r: any) => ({
        name: r.collectionName,
        artist: r.artistName || "",
        artwork: r.artworkUrl600 || r.artworkUrl100 || "",
        feedUrl: r.feedUrl || "",
      }));
  } catch {
    return [];
  }
}

async function buildRelatedFromRows(rows: any[], excludeShow: string): Promise<any[]> {
  const seen = new Set<string>();
  const shows: any[] = [];
  for (const row of rows) {
    const name = row.show_name || "";
    if (!name || name === excludeShow || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    shows.push({
      name,
      artist: name,
      artwork: null,
      feedUrl: row.url || "",
    });
    if (shows.length >= 6) break;
  }
  // Enrich artwork for top 3
  await Promise.all(
    shows.slice(0, 3).map(async (s) => {
      if (!s.artwork) s.artwork = await fetchArtwork(s.name);
    })
  );
  return shows;
}

function buildRelatedFromFollows(follows: any[]): any[] {
  return (follows as any[]).slice(0, 6).map((f: any) => ({
    name: f.show_name || "",
    artist: f.show_name || "",
    artwork: f.artwork || null,
    feedUrl: f.feed_url || "",
  }));
}

function dedupeShows(shows: any[]): any[] {
  const seen = new Set<string>();
  return shows.filter((s) => {
    const key = (s.name || "").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Main handler ─────────────────────────────────────────────────────────────

export default async (req: Request) => {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") || "trending";
  const category = url.searchParams.get("category") || "";
  const topic = url.searchParams.get("topic") || "";
  const userId = url.searchParams.get("userId") || "";

  // Cache check (skip for personalized)
  const cacheKey =
    mode === "personalized" ? null :
    mode === "topic" ? `discover-hero-topic-${topic.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` :
    mode === "category" ? `discover-hero-cat-${category}` :
    "discover-hero-trending";

  if (cacheKey) {
    try {
      const store = getStore("podlens-cache");
      const cached = (await store.get(cacheKey, { type: "json" })) as any;
      if (cached && cached.ts && Date.now() - cached.ts < CACHE_TTL) {
        return json(cached.data);
      }
    } catch {}
  }

  const sb = getSupabaseAdmin();
  if (!sb) return json({ hero: null, relatedShows: [] });

  let result: any;
  try {
    switch (mode) {
      case "category":
        result = await modeCategory(sb, category);
        break;
      case "topic":
        result = await modeTopic(sb, topic);
        break;
      case "personalized":
        if (!userId) return json({ hero: null, relatedShows: [] }, 400);
        result = await modePersonalized(sb, userId);
        break;
      default:
        result = await modeTrending(sb);
    }
  } catch {
    return json({ hero: null, relatedShows: [] });
  }

  // Cache result
  if (cacheKey) {
    try {
      const store = getStore("podlens-cache");
      await store.setJSON(cacheKey, { data: result, ts: Date.now() });
    } catch {}
  }

  return json(result);
};

export const config: Config = { path: "/api/discover-hero" };
