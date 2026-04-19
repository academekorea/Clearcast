import type { Config } from "@netlify/functions";
import { getSupabaseAdmin } from "./lib/supabase.js";
import { findOrCreateShow } from "./lib/show-matcher.js";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const { userId, action, showName, feedUrl, artwork } = body;
  if (!userId || !action || !showName) {
    return new Response(JSON.stringify({ error: "userId, action, showName required" }), {
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
    // Resolve canonical show_id via matcher
    const match = await findOrCreateShow({
      name: showName,
      feed_url: feedUrl || null,
      artwork_url: artwork || null,
      source_type: "podlens",
    });
    const showId = match?.showId || null;

    if (action === "follow") {
      // Check for existing row (incl. tombstoned)
      let existingRow: any = null;
      if (showId) {
        const { data } = await sb.from("followed_shows")
          .select("id, unfollowed_at, platform")
          .eq("user_id", userId)
          .eq("show_id", showId)
          .maybeSingle();
        existingRow = data;
      }
      if (!existingRow && feedUrl) {
        const { data } = await sb.from("followed_shows")
          .select("id, unfollowed_at, platform")
          .eq("user_id", userId)
          .eq("feed_url", feedUrl)
          .maybeSingle();
        existingRow = data;
      }

      if (existingRow) {
        // Restore tombstone (if any) + set platform to 'podlens' on re-follow
        const { error } = await sb.from("followed_shows")
          .update({
            unfollowed_at: null,
            platform: "podlens",
            show_name: showName,
            artwork: artwork || null,
            show_id: showId,
            followed_at: new Date().toISOString(),
          })
          .eq("id", existingRow.id);
        if (error) throw error;
        return new Response(JSON.stringify({ ok: true, action: "restored" }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }

      // Fresh follow
      const { error } = await sb.from("followed_shows").insert({
        user_id: userId,
        show_id: showId,
        show_name: showName,
        feed_url: feedUrl || null,
        artwork: artwork || null,
        platform: "podlens",
        followed_at: new Date().toISOString(),
      });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, action: "followed" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });

    } else if (action === "unfollow") {
      // Soft-delete via tombstone
      let targetId: string | null = null;
      if (showId) {
        const { data } = await sb.from("followed_shows")
          .select("id").eq("user_id", userId).eq("show_id", showId)
          .is("unfollowed_at", null).maybeSingle();
        if (data) targetId = data.id;
      }
      if (!targetId && feedUrl) {
        const { data } = await sb.from("followed_shows")
          .select("id").eq("user_id", userId).eq("feed_url", feedUrl)
          .is("unfollowed_at", null).maybeSingle();
        if (data) targetId = data.id;
      }
      if (!targetId) {
        const { data } = await sb.from("followed_shows")
          .select("id").eq("user_id", userId).eq("show_name", showName)
          .is("unfollowed_at", null).maybeSingle();
        if (data) targetId = data.id;
      }
      if (targetId) {
        const { error } = await sb.from("followed_shows")
          .update({ unfollowed_at: new Date().toISOString() })
          .eq("id", targetId);
        if (error) throw error;
        return new Response(JSON.stringify({ ok: true, action: "unfollowed" }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, action: "noop" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[follow-show]", err?.message || err);
    return new Response(JSON.stringify({ error: err?.message || "Internal" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/follow-show" };
