import type { Config } from "@netlify/functions";
import { getSupabaseAdmin } from "./lib/supabase.js";

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const { userId, action, showName, feedUrl, artwork } = await req.json();
  if (!userId || !showName || !feedUrl) {
    return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const sb = getSupabaseAdmin();
  if (!sb) return new Response(JSON.stringify({ ok: false }), { headers: { "Content-Type": "application/json" } });

  if (action === "follow") {
    const { error } = await sb.from("followed_shows").upsert({
      user_id: userId, show_name: showName, feed_url: feedUrl, artwork_url: artwork || null,
    }, { onConflict: "user_id,feed_url" });
    if (error) console.error("[follow-show] upsert error:", error);
  } else {
    const { error } = await sb.from("followed_shows").delete().eq("user_id", userId).eq("feed_url", feedUrl);
    if (error) console.error("[follow-show] delete error:", error);
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
};

export const config: Config = { path: "/api/follow-show" };
