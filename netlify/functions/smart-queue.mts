import type { Config } from "@netlify/functions";
import { getSupabaseAdmin } from "./lib/supabase.js";

// GET  /api/smart-queue?userId=...&action=status   — queue items + show list
// POST /api/smart-queue                             — toggle settings

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req: Request): Promise<Response> => {
  const sb = getSupabaseAdmin();
  if (!sb) return json({ error: "Service unavailable" }, 503);

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return json({ error: "userId required" }, 400);

  // ── GET: return queue status + followed shows ──────────────────────────────
  if (req.method === "GET") {
    const action = url.searchParams.get("action") || "status";

    if (action === "status") {
      // Recent queue items for this user
      const { data: items } = await sb
        .from("analysis_queue")
        .select("id, show_name, episode_title, status, priority, queued_at, completed_at, analysis_id, error")
        .eq("user_id", userId)
        .order("queued_at", { ascending: false })
        .limit(20);

      // User's smart_queue_enabled flag + tier
      const { data: user } = await sb
        .from("users")
        .select("tier, smart_queue_enabled")
        .eq("id", userId)
        .maybeSingle();

      // Followed shows with smart_queue flag
      const { data: shows } = await sb
        .from("followed_shows")
        .select("id, show_slug, show_name, show_artwork, feed_url, smart_queue, last_checked_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });

      const pending = (items || []).filter(i => i.status === "pending" || i.status === "processing");
      const completed = (items || []).filter(i => i.status === "complete").slice(0, 5);

      return json({
        enabled: user?.smart_queue_enabled ?? false,
        tier: user?.tier ?? "free",
        pending,
        completed,
        shows: shows || [],
      });
    }

    return json({ error: "Unknown action" }, 400);
  }

  // ── POST: toggle smart_queue_enabled or per-show smart_queue ───────────────
  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

    const { action, enabled, showId, showSlug } = body;

    // Toggle global Smart Queue for this user
    if (action === "toggle_user") {
      if (typeof enabled !== "boolean") return json({ error: "enabled required" }, 400);

      await sb.from("users")
        .update({ smart_queue_enabled: enabled })
        .eq("id", userId);

      return json({ ok: true, smart_queue_enabled: enabled });
    }

    // Toggle Smart Queue for a specific show
    if (action === "toggle_show") {
      if (typeof enabled !== "boolean") return json({ error: "enabled required" }, 400);
      if (!showId && !showSlug) return json({ error: "showId or showSlug required" }, 400);

      // Enforce Creator tier limit (max 5 shows)
      if (enabled) {
        const { data: user } = await sb.from("users")
          .select("tier")
          .eq("id", userId)
          .maybeSingle();

        if (user?.tier === "creator") {
          const { count } = await sb
            .from("followed_shows")
            .select("*", { count: "exact", head: true })
            .eq("user_id", userId)
            .eq("smart_queue", true);

          if ((count || 0) >= 5) {
            return json({ error: "Starter Lens allows up to 5 Smart Queue shows. Upgrade to Pro Lens for unlimited.", limitReached: true }, 403);
          }
        }
      }

      let q = sb.from("followed_shows").update({ smart_queue: enabled }).eq("user_id", userId);
      if (showId) q = q.eq("id", showId);
      else q = q.eq("show_slug", showSlug);
      await q;

      return json({ ok: true, smart_queue: enabled });
    }

    return json({ error: "Unknown action" }, 400);
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config: Config = { path: "/api/smart-queue" };
