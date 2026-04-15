import type { Config } from "@netlify/functions";
import { getSupabaseAdmin } from "./lib/supabase.js";

export default async (req: Request) => {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");

  if (!userId) {
    return new Response(JSON.stringify({ error: "userId required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sb = getSupabaseAdmin();
  if (!sb) {
    return new Response(JSON.stringify({ error: "Database not configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Fetch user preferences + analysis history in parallel
  const [userRes, analysesRes, listenRes] = await Promise.allSettled([
    sb
      .from("users")
      .select(
        "spotify_connected, youtube_connected, theme, region, " +
        "interests, voice_preference"
      )
      .eq("id", userId)
      .maybeSingle(),
    // Rebuild analyzed_episodes from the analyses table (source of truth)
    sb
      .from("analyses")
      .select(
        "job_id, episode_title, show_name, bias_score, bias_label, " +
        "bias_left_pct, bias_center_pct, bias_right_pct, " +
        "duration_minutes, url, analyzed_at, host_trust_score"
      )
      .eq("user_id", userId)
      .order("analyzed_at", { ascending: false })
      .limit(50),
    // Rebuild listen_history from events table
    sb
      .from("events")
      .select("properties, created_at")
      .eq("user_id", userId)
      .in("event_type", ["listen", "spotify_listen"])
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const userData =
    userRes.status === "fulfilled" && userRes.value.data
      ? userRes.value.data
      : {};

  if (userRes.status === "fulfilled" && userRes.value.error) {
    console.error("[get-user-profile] users query:", userRes.value.error.message);
  }

  // Map analyses rows to the frontend analyzedEpisodes format
  const analyzedEpisodes: any[] = [];
  if (analysesRes.status === "fulfilled" && analysesRes.value.data) {
    for (const row of analysesRes.value.data) {
      analyzedEpisodes.push({
        jobId: row.job_id,
        episodeTitle: row.episode_title || "",
        showName: row.show_name || "",
        biasScore: row.bias_score,
        biasLabel: row.bias_label || "",
        leftPct: row.bias_left_pct ?? 0,
        centerPct: row.bias_center_pct ?? 0,
        rightPct: row.bias_right_pct ?? 0,
        durationMinutes: row.duration_minutes,
        url: row.url || "",
        analyzedAt: row.analyzed_at,
        hostTrustScore: row.host_trust_score,
      });
    }
  }

  // Map listen events to frontend format
  const listenHistory: any[] = [];
  if (listenRes.status === "fulfilled" && listenRes.value.data) {
    for (const row of listenRes.value.data) {
      const p = row.properties || {};
      listenHistory.push({
        showName: p.showName || "",
        episodeTitle: p.episodeTitle || "",
        url: p.url || p.spotifyUrl || "",
        leftPct: p.leftPct || 0,
        centerPct: p.centerPct || 0,
        rightPct: p.rightPct || 0,
        biasLabel: p.biasLabel || "",
        durationMinutes: p.durationMinutes || null,
        listenedAt: row.created_at,
        weight: 0.3,
      });
    }
  }

  const result = {
    ...userData,
    analyzed_episodes: analyzedEpisodes,
    listen_history: listenHistory.length > 0 ? listenHistory : undefined,
  };

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = { path: "/api/get-user-profile" };
