import type { Config } from "@netlify/functions";
import { getSupabaseAdmin } from "./lib/supabase.js";

const ALLOWED_FIELDS = new Set([
  "analyzed_episodes",
  "listen_history",
  "liked_episodes",
  "playlists",
  "spotify_connected",
  "youtube_connected",
  "theme",
  "region",
]);

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { userId, field, value } = body;

  if (!userId || typeof userId !== "string") {
    return new Response(JSON.stringify({ error: "userId required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!field || !ALLOWED_FIELDS.has(field)) {
    return new Response(
      JSON.stringify({ error: "Invalid field. Allowed: " + [...ALLOWED_FIELDS].join(", ") }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const sb = getSupabaseAdmin();
  if (!sb) {
    return new Response(JSON.stringify({ error: "Database not configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { error } = await sb
    .from("users")
    .update({ [field]: value })
    .eq("id", userId);

  if (error) {
    console.error("[sync-user-data]", field, error.message);
    return new Response(JSON.stringify({ error: "Write failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = { path: "/api/sync-user-data" };
