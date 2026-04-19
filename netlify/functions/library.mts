import type { Config } from "@netlify/functions";
import { getSupabaseAdmin } from "./lib/supabase.js";

export default async (req: Request) => {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");

  const json = (data: object, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  if (!userId) return json({ error: "userId required" }, 400);

  const sb = getSupabaseAdmin();
  if (!sb) return json({ error: "Database not configured" }, 503);

  try {
    // Fetch all three panels in parallel
    const [followedRes, savedRes, analyzedRes] = await Promise.allSettled([
      // Followed shows — join with shows table for canonical slug/artwork
      sb
        .from("followed_shows")
        .select(`
          id,
          show_id,
          show_name,
          artwork,
          spotify_url,
          platform,
          followed_at,
          shows:show_id ( slug, name, artwork_url, publisher, host_name )
        `)
        .eq("user_id", userId)
        .is("unfollowed_at", null)
        .order("followed_at", { ascending: false })
        .limit(100),

      // Saved episodes — join with shows table for slug
      sb
        .from("saved_episodes")
        .select(`
          id,
          show_id,
          episode_title,
          show_name,
          artwork_url,
          episode_url,
          platform,
          published_at,
          duration_sec,
          saved_at,
          shows:show_id ( slug )
        `)
        .eq("user_id", userId)
        .is("unliked_at", null)
        .order("saved_at", { ascending: false })
        .limit(100),

      // Analyses — join with shows table
      sb
        .from("analyses")
        .select(`
          id,
          show_id,
          show_name,
          episode_title,
          bias_score,
          bias_label,
          bias_direction,
          analyzed_at,
          source_url,
          show_artwork,
          shows:show_id ( slug, artwork_url )
        `)
        .eq("user_id", userId)
        .order("analyzed_at", { ascending: false, nullsFirst: false })
        .limit(50),
    ]);

    const followed = followedRes.status === "fulfilled" && !followedRes.value.error
      ? followedRes.value.data || []
      : [];

    const saved = savedRes.status === "fulfilled" && !savedRes.value.error
      ? savedRes.value.data || []
      : [];

    const analyzed = analyzedRes.status === "fulfilled" && !analyzedRes.value.error
      ? analyzedRes.value.data || []
      : [];

    return json({
      followed,
      saved,
      analyzed,
      counts: {
        followed: followed.length,
        saved: saved.length,
        analyzed: analyzed.length,
      },
    });
  } catch (err: any) {
    console.error("[library] Fatal:", err);
    return json({ error: err.message || "Failed to load library" }, 500);
  }
};

export const config: Config = { path: "/api/library" };
