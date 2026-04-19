import type { Config } from "@netlify/functions";
import { getSupabaseAdmin } from "./lib/supabase.js";

export default async (req: Request) => {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId") || "";

  if (!userId) {
    return new Response(JSON.stringify({ shows: [] }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const sb = getSupabaseAdmin();
    if (!sb) return new Response(JSON.stringify({ shows: [] }), { headers: { "Content-Type": "application/json" } });

    const { data, error } = await sb
      .from("followed_shows")
      .select("show_name, feed_url, artwork, platform, spotify_url, youtube_channel_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[get-followed-shows] error:", error);
      return new Response(JSON.stringify({ shows: [] }), { headers: { "Content-Type": "application/json" } });
    }

    const shows = (data || []).map((row: any) => ({
      name: row.show_name,
      feedUrl: row.feed_url,
      artwork: row.artwork,
      platform: row.platform || "manual",
      spotifyUrl: row.spotify_url || null,
      youtubeChannelId: row.youtube_channel_id || null,
      addedAt: row.created_at,
    }));

    return new Response(JSON.stringify({ shows }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  } catch (e: any) {
    console.error("[get-followed-shows] exception:", e?.message);
    return new Response(JSON.stringify({ shows: [] }), { headers: { "Content-Type": "application/json" } });
  }
};

export const config: Config = { path: "/api/get-followed-shows" };
