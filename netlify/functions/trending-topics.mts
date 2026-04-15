import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { getSupabaseAdmin } from "./lib/supabase.js";

const CACHE_KEY = "trending-topics-cache";
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function json(data: object, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
  });
}

export default async () => {
  // Check cache first
  try {
    const store = getStore("podlens-cache");
    const cached = await store.get(CACHE_KEY, { type: "json" }) as any;
    if (cached && cached.ts && Date.now() - cached.ts < CACHE_TTL) {
      return json({ topics: cached.topics, heroes: cached.heroes || [] });
    }
  } catch {}

  const sb = getSupabaseAdmin();
  if (!sb) {
    return json({ topics: [] });
  }

  try {
    // Query last 30 days of analyses
    const recent = await sb
      .from("analyses")
      .select("show_name")
      .gte("analyzed_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    let rows = (recent.data || []) as any[];

    // If fewer than 5 results, fall back to all-time
    if (rows.length < 5) {
      const allTime = await sb.from("analyses").select("show_name");
      rows = (allTime.data || []) as any[];
    }

    // Group by show_name and count
    const counts: Record<string, number> = {};
    for (const row of rows) {
      const name = row.show_name;
      if (name) counts[name] = (counts[name] || 0) + 1;
    }

    const topics = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));

    // Fetch featured episodes per category (most recent analysis in each)
    const categories = ["news", "tech", "business", "society", "crime", "comedy", "health", "sports"];
    const heroRows: any[] = [];
    try {
      const { data: recentAnalyses } = await sb
        .from("analyses")
        .select("show_name, episode_title, url, bias_label, show_category, analyzed_at, duration_minutes")
        .not("show_name", "is", null)
        .order("analyzed_at", { ascending: false })
        .limit(100);

      if (recentAnalyses) {
        const seen = new Set<string>();
        for (const row of recentAnalyses as any[]) {
          const cat = (row.show_category || "").toLowerCase();
          if (cat && categories.includes(cat) && !seen.has(cat)) {
            seen.add(cat);
            // Check if URL is YouTube
            const ytMatch = (row.url || "").match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
            heroRows.push({
              category: cat,
              showName: row.show_name,
              episodeTitle: row.episode_title || row.show_name,
              url: row.url || "",
              ytId: ytMatch ? ytMatch[1] : null,
              biasLabel: row.bias_label || "",
              durationMinutes: row.duration_minutes,
              analyzedAt: row.analyzed_at,
            });
          }
        }
        // Also add overall "all" hero — most recent analysis with YouTube
        const ytHero = (recentAnalyses as any[]).find((r: any) => /youtube\.com|youtu\.be/.test(r.url || ""));
        if (ytHero) {
          const ytM = (ytHero.url || "").match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
          heroRows.push({
            category: "all",
            showName: ytHero.show_name,
            episodeTitle: ytHero.episode_title || ytHero.show_name,
            url: ytHero.url,
            ytId: ytM ? ytM[1] : null,
            biasLabel: ytHero.bias_label || "",
            durationMinutes: ytHero.duration_minutes,
            analyzedAt: ytHero.analyzed_at,
          });
        }
      }
    } catch {}

    // Cache result
    try {
      const store = getStore("podlens-cache");
      await store.setJSON(CACHE_KEY, { topics, heroes: heroRows, ts: Date.now() });
    } catch {}

    return json({ topics, heroes: heroRows });
  } catch {
    return json({ topics: [] });
  }
};

export const config: Config = { path: "/api/trending-topics" };
