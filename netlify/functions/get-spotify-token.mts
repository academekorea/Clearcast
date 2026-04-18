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

  const { data, error } = await sb
    .from("connected_accounts")
    .select("access_token, refresh_token, expires_at, provider_username")
    .eq("user_id", userId)
    .eq("provider", "spotify")
    .maybeSingle();

  if (error || !data) {
    return new Response(JSON.stringify({ error: "Spotify not connected" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  let accessToken = data.access_token;
  const expiresAt = data.expires_at
    ? (typeof data.expires_at === "number"
        ? data.expires_at
        : new Date(data.expires_at).getTime())
    : 0;
  const BUFFER_MS = 5 * 60 * 1000; // 5 minute buffer

  // Refresh token if expired or expiring within 5 minutes
  if (data.refresh_token && expiresAt && Date.now() > expiresAt - BUFFER_MS) {
    const clientId = Netlify.env.get("SPOTIFY_CLIENT_ID") || "";
    const clientSecret = Netlify.env.get("SPOTIFY_CLIENT_SECRET") || "";

    if (clientId && clientSecret) {
      try {
        const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: "Basic " + btoa(clientId + ":" + clientSecret),
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: data.refresh_token,
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (tokenRes.ok) {
          const tokenData = await tokenRes.json() as any;
          accessToken = tokenData.access_token;
          const newExpiresAt = Date.now() + (tokenData.expires_in || 3600) * 1000;

          // Update stored token in Supabase
          await sb
            .from("connected_accounts")
            .update({
              access_token: accessToken,
              expires_at: newExpiresAt,
              // Spotify may return a new refresh_token
              ...(tokenData.refresh_token ? { refresh_token: tokenData.refresh_token } : {}),
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", userId)
            .eq("provider", "spotify");
        } else {
          console.warn("[get-spotify-token] Refresh failed:", tokenRes.status);
        }
      } catch (e: any) {
        console.warn("[get-spotify-token] Refresh error:", e.message);
      }
    }
  }

  return new Response(
    JSON.stringify({
      accessToken,
      displayName: data.provider_username || "",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
};

export const config: Config = { path: "/api/get-spotify-token" };
