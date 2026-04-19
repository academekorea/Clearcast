import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { findOrCreateShow } from "./lib/show-matcher.js";

interface SpotifyShow {
  id: string;
  name: string;
  publisher?: string;
  description?: string;
  images?: Array<{ url: string; width?: number; height?: number }>;
  total_episodes?: number;
  external_urls?: { spotify?: string };
}

// Pick the largest image from Spotify's images array (not always sorted by size)
function bestImage(images?: Array<{ url: string; width?: number; height?: number }>): string {
  if (!images || images.length === 0) return "";
  if (images.length === 1) return images[0].url;
  const withSize = images.filter(i => i.width);
  if (withSize.length) return withSize.sort((a, b) => (b.width || 0) - (a.width || 0))[0].url;
  return images[0].url; // fallback to first
}

interface SpotifyEpisode {
  id: string;
  name: string;
  duration_ms?: number;
  release_date?: string;
  external_urls?: { spotify?: string };
  show?: SpotifyShow;
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const json = (data: object, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

  try {
    const body = await req.json();
    const { spotifyAccessToken, userId, userPlan, forceFresh } = body;
    if (!spotifyAccessToken || !userId) return json({ error: "Missing required fields" }, 400);

    const store = getStore("podlens-cache");
    const cacheKey = `spotify-import-${userId}`;

    // Cache check (skip if forceFresh)
    if (!forceFresh) {
      try {
        const cached = await store.get(cacheKey, { type: "json" }) as any;
        if (cached?.cachedAt && Date.now() - cached.cachedAt < 60 * 60 * 1000) {
          return json({ ...cached, fromCache: true });
        }
      } catch {}
    }

    const headers = { Authorization: `Bearer ${spotifyAccessToken}` };

    // Fetch followed shows + recently played + saved episodes in parallel
    const [showsRes, recentRes, episodesRes] = await Promise.allSettled([
      fetch("https://api.spotify.com/v1/me/shows?limit=50", {
        headers, signal: AbortSignal.timeout(8000),
      }),
      fetch("https://api.spotify.com/v1/me/player/recently-played?limit=50&type=episode", {
        headers, signal: AbortSignal.timeout(8000),
      }),
      fetch("https://api.spotify.com/v1/me/episodes?limit=50", {
        headers, signal: AbortSignal.timeout(8000),
      }),
    ]);

    const followedShows: SpotifyShow[] = [];
    if (showsRes.status === "fulfilled" && showsRes.value.ok) {
      const data = await showsRes.value.json();
      for (const item of (data.items || [])) {
        if (item.show) followedShows.push(item.show);
      }
    } else if (showsRes.status === "fulfilled" && showsRes.value.status === 401) {
      return json({ error: "Spotify token expired", needsReconnect: true }, 401);
    }

    const recentEpisodes: any[] = [];
    const recentShowNames = new Set<string>();
    if (recentRes.status === "fulfilled" && recentRes.value.ok) {
      const data = await recentRes.value.json();
      for (const item of (data.items || [])) {
        if (!item.track) continue;
        const ep = item.track;
        if (ep.show?.name) recentShowNames.add(ep.show.name);
        recentEpisodes.push({
          name: ep.name,
          showName: ep.show?.name || "",
          playedAt: item.played_at,
          spotifyUrl: ep.external_urls?.spotify || "",
          artwork: bestImage(ep.show?.images) || "",
        });
      }
    }

    const savedEpisodes: SpotifyEpisode[] = [];
    if (episodesRes.status === "fulfilled" && episodesRes.value.ok) {
      const data = await episodesRes.value.json();
      for (const item of (data.items || [])) {
        if (item.episode) savedEpisodes.push({ ...item.episode, addedAt: item.added_at } as any);
      }
    }

    // Process followed shows: route through canonical matcher
    const showResults: any[] = [];
    for (const show of followedShows) {
      const matchResult = await findOrCreateShow({
        spotify_id: show.id,
        name: show.name,
        publisher: show.publisher || null,
        description: (show.description || "").slice(0, 500),
        artwork_url: bestImage(show.images) || null,
        source_type: "spotify",
      });

      showResults.push({
        showId: matchResult?.showId || null,
        spotifyId: show.id,
        name: show.name,
        publisher: show.publisher || "",
        artwork: bestImage(show.images) || "",
        spotifyUrl: show.external_urls?.spotify || "",
        analyzed: false,
      });
    }

    // Build preliminary bias fingerprint (preserved from previous version)
    const isPaid = ["creator", "operator", "studio", "starter", "pro"].includes(String(userPlan || "").toLowerCase());
    let preliminaryFingerprint: any = null;
    let fingerprintLocked = !isPaid;
    if (isPaid && showResults.length >= 3) {
      preliminaryFingerprint = {
        leftPct: 33, centerPct: 34, rightPct: 33,
        confidence: "preliminary",
        showCount: showResults.length,
      };
    }

    const suggestedAnalyses = showResults
      .filter(s => !s.analyzed)
      .slice(0, 3)
      .map(s => ({ name: s.name, artwork: s.artwork, spotifyUrl: s.spotifyUrl }));

    const lastSyncedAt = new Date().toISOString();

    const result = {
      followedShows: showResults.slice(0, 50),
      preliminaryFingerprint,
      fingerprintLocked,
      suggestedAnalyses,
      totalFollowed: followedShows.length,
      totalSavedEpisodes: savedEpisodes.length,
      recentShowCount: recentShowNames.size,
      recentEpisodes: recentEpisodes.slice(0, 10),
      lastSyncedAt,
      cachedAt: Date.now(),
    };

    try { await store.setJSON(cacheKey, result); } catch {}

    // ─── WRITE TO SUPABASE ────────────────────────────────────────────────
    const supabaseUrl = Netlify.env.get("SUPABASE_URL");
    const supabaseKey = Netlify.env.get("SUPABASE_SERVICE_KEY");
    if (!supabaseUrl || !supabaseKey || !userId) return json(result);

    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

    let followedWriteCount = 0;
    let savedEpisodeWriteCount = 0;
    const writeErrors: string[] = [];

    // Write ALL followed shows (no 20-cap) using show_id conflict key
    for (const show of showResults) {
      if (!show.showId) continue; // skip if matcher failed
      const { error } = await sb.from("followed_shows").upsert({
        user_id: userId,
        show_id: show.showId,
        show_name: show.name,
        artwork: show.artwork || null,
        spotify_id: show.spotifyId || null,
        spotify_url: show.spotifyUrl || null,
        platform: "spotify",
        followed_at: new Date().toISOString(),
      }, { onConflict: "user_id,show_id" });
      if (error) {
        writeErrors.push(`followed_shows[${show.name}]: ${error.message}`);
      } else {
        followedWriteCount++;
      }
    }

    // Write saved episodes to saved_episodes table
    for (const ep of savedEpisodes) {
      const showMatch = ep.show ? await findOrCreateShow({
        spotify_id: ep.show.id,
        name: ep.show.name,
        publisher: ep.show.publisher || null,
        artwork_url: bestImage(ep.show.images) || null,
        source_type: "spotify",
      }) : null;

      const { error } = await sb.from("saved_episodes").upsert({
        user_id: userId,
        show_id: showMatch?.showId || null,
        episode_title: ep.name,
        show_name: ep.show?.name || "",
        artwork_url: bestImage(ep.show?.images) || null,
        episode_url: ep.external_urls?.spotify || null,
        platform: "spotify",
        platform_episode_id: ep.id,
        published_at: ep.release_date ? new Date(ep.release_date).toISOString() : null,
        duration_sec: ep.duration_ms ? Math.round(ep.duration_ms / 1000) : null,
        saved_source: "spotify",
        saved_at: (ep as any).addedAt || new Date().toISOString(),
      }, { onConflict: "user_id,platform,platform_episode_id" });
      if (error) {
        writeErrors.push(`saved_episodes[${ep.name}]: ${error.message}`);
      } else {
        savedEpisodeWriteCount++;
      }
    }

    // Update users table (preserved from previous version + lastSyncedAt)
    const updatePayload: Record<string, any> = {
      spotify_connected: true,
      spotify_show_count: followedShows.length,
      spotify_imported_at: lastSyncedAt,
    };
    if (preliminaryFingerprint) updatePayload.bias_fingerprint = preliminaryFingerprint;

    // Genre inference (preserved)
    if (followedShows.length > 0) {
      const genreHints: Record<string, number> = {};
      const keywordMap: Record<string, string[]> = {
        news: ["news", "daily", "report", "headline", "npr", "cnn", "bbc"],
        politics: ["politic", "democrat", "republican", "vote", "election", "congress", "policy"],
        technology: ["tech", "code", "software", "ai", "startup", "silicon"],
        business: ["business", "finance", "economy", "invest", "market", "money"],
        comedy: ["comedy", "funny", "humor", "laugh", "joke"],
        "true-crime": ["crime", "murder", "detective", "investig", "serial"],
        health: ["health", "wellness", "mental", "fitness", "medical"],
        science: ["science", "research", "space", "physics", "biology"],
        history: ["history", "historical", "war", "ancient", "century"],
        sports: ["sports", "nfl", "nba", "football", "basketball", "soccer"],
        society: ["society", "culture", "social", "race", "gender"],
      };
      for (const show of followedShows) {
        const text = `${show.name} ${show.publisher || ""} ${show.description || ""}`.toLowerCase();
        for (const [genre, keywords] of Object.entries(keywordMap)) {
          if (keywords.some(kw => text.includes(kw))) {
            genreHints[genre] = (genreHints[genre] || 0) + 1;
          }
        }
      }
      const topGenres = Object.entries(genreHints)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([g]) => g);
      if (topGenres.length > 0) updatePayload.interests = topGenres;
    }

    const { error: userUpdateError } = await sb.from("users").update(updatePayload).eq("id", userId);
    if (userUpdateError) writeErrors.push(`users update: ${userUpdateError.message}`);

    return json({
      ...result,
      writeStats: {
        followedSynced: followedWriteCount,
        savedEpisodesSynced: savedEpisodeWriteCount,
        errors: writeErrors.length > 0 ? writeErrors.slice(0, 5) : undefined,
      },
    });
  } catch (err: any) {
    console.error("[spotify-import] Fatal error:", err);
    return json({ error: err.message || "Import failed", details: String(err) }, 500);
  }
};

export const config: Config = { path: "/api/spotify-import" };
