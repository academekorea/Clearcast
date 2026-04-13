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
    .select("access_token, provider_username")
    .eq("user_id", userId)
    .eq("provider", "spotify")
    .maybeSingle();

  if (error || !data) {
    return new Response(JSON.stringify({ error: "Spotify not connected" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      accessToken: data.access_token,
      displayName: data.provider_username || "",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
};

export const config: Config = { path: "/api/get-spotify-token" };
