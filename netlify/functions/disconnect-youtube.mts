import type { Config } from "@netlify/functions";
import { getSupabaseAdmin, trackEvent } from "./lib/supabase.js";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const userId = body.userId;

    if (!userId) {
      return new Response(JSON.stringify({ error: "Missing userId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return new Response(JSON.stringify({ error: "Server misconfigured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch stored tokens
    const { data: row } = await supabase
      .from("connected_accounts")
      .select("access_token,refresh_token")
      .eq("user_id", userId)
      .eq("provider", "youtube")
      .maybeSingle();

    // Revoke with Google (best effort — continue even if this fails)
    const tokenToRevoke = row?.refresh_token || row?.access_token;
    if (tokenToRevoke) {
      try {
        await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(tokenToRevoke), {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        // Token may already be expired/revoked — proceed with local cleanup
      }
    }

    // Delete the row from Supabase
    await supabase
      .from("connected_accounts")
      .delete()
      .eq("user_id", userId)
      .eq("provider", "youtube");

    trackEvent(userId, "youtube_disconnected", {});

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Disconnect failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/disconnect-youtube" };
