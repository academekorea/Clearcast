import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { getSupabaseAdmin } from "./lib/supabase.js";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const json = (data: object, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  try {
    const { userId } = await req.json();
    if (!userId) return json({ error: "userId required" }, 400);

    const sb = getSupabaseAdmin();
    if (!sb) return json({ error: "Database not configured" }, 503);

    // 1. Delete the token row from connected_accounts
    // NOTE: We intentionally do NOT delete rows from followed_shows,
    // saved_episodes, or clear bias_fingerprint / interests on users.
    // Disconnecting means "stop syncing new data" — user retains everything
    // they already imported. If they reconnect, new activity merges in.
    const { error: delErr } = await sb
      .from("connected_accounts")
      .delete()
      .eq("user_id", userId)
      .eq("provider", "spotify");

    if (delErr) {
      console.warn("[disconnect-spotify] delete error:", delErr.message);
    }

    // 2. Clear spotify auth flags on users table (not the data-derived fields)
    const { error: updErr } = await sb
      .from("users")
      .update({
        spotify_connected: false,
        spotify_imported_at: null,
      })
      .eq("id", userId);

    if (updErr) {
      console.warn("[disconnect-spotify] user update error:", updErr.message);
    }

    // 3. Invalidate the import cache blob
    try {
      const store = getStore("podlens-cache");
      await store.delete(`spotify-import-${userId}`);
    } catch {
      /* cache delete is best-effort */
    }

    return json({ success: true });
  } catch (err: any) {
    console.error("[disconnect-spotify] Fatal:", err);
    return json({ error: err.message || "Disconnect failed" }, 500);
  }
};

export const config: Config = { path: "/api/disconnect-spotify" };
