import type { Config } from "@netlify/functions";
import { getSupabaseAdmin } from "./lib/supabase.js";

export default async (req: Request) => {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) {
    return new Response(JSON.stringify({ error: "userId required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const sb = getSupabaseAdmin();
  if (!sb) {
    return new Response(JSON.stringify({ ok: false, error: "DB unavailable" }), {
      status: 503, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const [followedRes, likedRes] = await Promise.all([
      sb.from("followed_shows")
        .select("show_id, show_name, feed_url, artwork, platform, followed_at, shows:show_id(slug, name, artwork_url)")
        .eq("user_id", userId)
        .is("unfollowed_at", null),
      sb.from("saved_episodes")
        .select("show_id, episode_title, show_name, episode_url, artwork_url, platform, platform_episode_id, saved_source, saved_at")
        .eq("user_id", userId)
        .is("unliked_at", null)
        .limit(500),
    ]);

    const followedShows = (followedRes.data || []).map((f: any) => ({
      name: (f.shows && f.shows.name) || f.show_name || "",
      feedUrl: f.feed_url || "",
      artwork: (f.shows && f.shows.artwork_url) || f.artwork || "",
      platform: f.platform || "podlens",
      addedAt: f.followed_at,
    }));

    const likedEpisodes = (likedRes.data || []).map((e: any) => ({
      title: e.episode_title || "",
      showName: e.show_name || "",
      artwork: e.artwork_url || "",
      url: e.episode_url || "",
      platform: e.platform || "",
      platformEpisodeId: e.platform_episode_id || "",
      savedSource: e.saved_source || "podlens",
      likedAt: e.saved_at ? new Date(e.saved_at).getTime() : Date.now(),
    }));

    return new Response(JSON.stringify({ ok: true, followedShows, likedEpisodes }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[sync-library-state]", err?.message || err);
    return new Response(JSON.stringify({ ok: false, error: err?.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/sync-library-state" };
