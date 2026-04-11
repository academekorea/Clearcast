import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { getSupabaseAdmin } from "./lib/supabase.js";

// Returns connected platform status for a user
// Used on login to restore Spotify/YouTube connection state to localStorage

export default async (req: Request) => {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId") || "";

  if (!userId) {
    return new Response(JSON.stringify({ spotify: false, youtube: false }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  const result: any = { spotify: false, youtube: false };

  // Check Netlify Blobs first (fastest)
  try {
    const store = getStore("podlens-users");
    const spotifyData = await store.get(`spotify-${userId}`, { type: "json" }) as any;
    if (spotifyData?.accessToken) {
      result.spotify = true;
      result.spotifyToken = spotifyData.accessToken;
      result.spotifyDisplayName = spotifyData.spotifyDisplayName || "";
    }
    const ytData = await store.get(`youtube-${userId}`, { type: "json" }) as any;
    if (ytData?.accessToken) {
      result.youtube = true;
      result.youtubeDisplayName = ytData.channelTitle || "";
    }
  } catch {}

  // Fall back to Supabase connected_accounts if Blobs miss
  if (!result.spotify || !result.youtube) {
    try {
      const sb = getSupabaseAdmin();
      if (sb) {
        const { data } = await sb
          .from("connected_accounts")
          .select("provider, access_token, provider_username")
          .eq("user_id", userId);
        for (const row of (data || [])) {
          if (row.provider === "spotify" && !result.spotify) {
            result.spotify = true;
            result.spotifyToken = row.access_token;
            result.spotifyDisplayName = row.provider_username || "";
          }
          if (row.provider === "youtube" && !result.youtube) {
            result.youtube = true;
            result.youtubeDisplayName = row.provider_username || "";
          }
        }
      }
    } catch {}
  }

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
};

export const config: Config = { path: "/api/get-connections" };
