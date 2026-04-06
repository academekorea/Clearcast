import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { getSupabaseAdmin } from "./lib/supabase.js";
import { sendEmail } from "./lib/email.js";

// Runs every 6 hours — two jobs in one:
// 1. Blobs-based: notify Creator+ users of new episodes on followed shows
// 2. Supabase smart queue: detect new episodes and enqueue analyses

// ── Blobs-based episode check (existing) ────────────────────────────────────

async function runBlobsCheck(): Promise<{ checked: number; newEpisodesFound: number; errors: string[] }> {
  const userStore = getStore("podlens-users");
  const metaStore = getStore("podlens-meta");
  let checked = 0;
  let newEpisodesFound = 0;
  const errors: string[] = [];

  try {
    const allKeys = await userStore.list();
    const followKeys = (allKeys.blobs || []).filter(k => k.key.startsWith("show-follow-"));

    for (const key of followKeys.slice(0, 200)) {
      try {
        const follow = await userStore.get(key.key, { type: "json" }) as any;
        if (!follow?.feedUrl || !follow?.userId) continue;

        const userKey = `u-${follow.userId}` in allKeys ? `u-${follow.userId}` : follow.userId;
        const user = await userStore.get(userKey, { type: "json" }).catch(() => null) as any;
        if (!user || !["creator", "operator", "studio"].includes(user?.plan || "")) continue;

        const feedUrl: string = follow.feedUrl;
        const lastKnownGuid: string = follow.lastKnownGuid || "";
        const showSlug: string = follow.showSlug || "";

        const rssRes = await fetch(feedUrl, { signal: AbortSignal.timeout(8000) });
        if (!rssRes.ok) continue;
        const rssText = await rssRes.text();

        const guidMatch = rssText.match(/<guid[^>]*>([^<]+)<\/guid>/);
        const latestGuid = guidMatch?.[1]?.trim() || "";

        const titleMatch = rssText.match(/<item[^>]*>[\s\S]*?<title>(?:<!\[CDATA\[)?([^\]<]+)(?:\]\]>)?<\/title>/);
        const latestTitle = titleMatch?.[1]?.trim() || "New Episode";

        checked++;

        if (latestGuid && latestGuid !== lastKnownGuid) {
          newEpisodesFound++;
          await userStore.setJSON(key.key, {
            ...follow,
            lastKnownGuid: latestGuid,
            lastCheckedAt: new Date().toISOString(),
          });
          const notifKey = `notif-${follow.userId}-${Date.now()}`;
          await userStore.setJSON(notifKey, {
            type: "new_episode",
            userId: follow.userId,
            showSlug,
            showName: follow.showName || "",
            episodeTitle: latestTitle,
            feedUrl,
            guid: latestGuid,
            createdAt: new Date().toISOString(),
            read: false,
          });
        } else {
          await userStore.setJSON(key.key, {
            ...follow,
            lastCheckedAt: new Date().toISOString(),
          });
        }
      } catch (e: any) {
        errors.push(e?.message || "unknown");
      }
    }

    await metaStore.setJSON("episode-check-last-run", {
      ranAt: new Date().toISOString(),
      checked,
      newEpisodesFound,
    });
  } catch {}

  return { checked, newEpisodesFound, errors };
}

// ── Smart Queue Supabase path ────────────────────────────────────────────────

async function parseLatestEpisode(xml: string): Promise<{
  guid: string; title: string; audioUrl: string | null
} | null> {
  const itemMatch = xml.match(/<item[\s>][\s\S]*?<\/item>/i);
  if (!itemMatch) return null;
  const item = itemMatch[0];
  const guidMatch = item.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
  const guid = guidMatch?.[1]?.trim() || "";
  const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
  const title = titleMatch?.[1]?.trim() || "New Episode";
  const enclosureMatch = item.match(/<enclosure[^>]+url="([^"]+)"/i);
  const audioUrl = enclosureMatch?.[1] || null;
  return { guid, title, audioUrl };
}

async function checkShowForSmartQueue(sb: any, user: any, show: any): Promise<void> {
  if (!show.feed_url) return;

  try {
    const rssRes = await fetch(show.feed_url, {
      headers: { "User-Agent": "Podlens/1.0 (+https://podlens.app)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!rssRes.ok) return;
    const xml = await rssRes.text();

    const latest = await parseLatestEpisode(xml);
    if (!latest?.guid) return;

    const lastKnown = show.last_episode_id || show.last_episode_guid || "";
    if (latest.guid === lastKnown) {
      // No new episode — just update checked time
      await sb.from("followed_shows")
        .update({ last_checked_at: new Date().toISOString() })
        .eq("id", show.id)
        .catch(() => {});
      return;
    }

    // New episode found — check if already queued
    const episodeKey = latest.audioUrl || latest.guid;
    const { data: existing } = await sb
      .from("analysis_queue")
      .select("id")
      .eq("user_id", user.id)
      .eq("episode_url", episodeKey)
      .in("status", ["pending", "processing", "complete"])
      .maybeSingle();

    if (existing) {
      // Already queued or done — update guid, move on
      await sb.from("followed_shows")
        .update({ last_episode_id: latest.guid, last_checked_at: new Date().toISOString() })
        .eq("id", show.id)
        .catch(() => {});
      return;
    }

    // For Creator tier: check monthly analysis count
    if (user.tier === "creator") {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const { count } = await sb
        .from("analysis_queue")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .in("status", ["pending", "processing", "complete"])
        .gte("queued_at", startOfMonth.toISOString());
      const monthlyLimit = 25;
      if ((count || 0) >= monthlyLimit) {
        // Notify user they're at limit (in-app only to avoid email spam)
        await sb.from("notifications").insert({
          user_id: user.id,
          type: "smart_queue_limit",
          title: "Smart Queue paused — monthly limit reached",
          body: `New ${show.show_name} episode found but you've used all ${monthlyLimit} analyses this month. Upgrade to Operator for unlimited.`,
          url: "/pricing.html",
          read: false,
          created_at: new Date().toISOString(),
        }).catch(() => {});
        return;
      }
    }

    // Enqueue
    const priority = user.tier === "studio" ? 1 : user.tier === "operator" ? 2 : 5;
    await sb.from("analysis_queue").insert({
      user_id: user.id,
      show_name: show.show_name,
      episode_url: episodeKey,
      episode_title: latest.title,
      feed_url: show.feed_url,
      status: "pending",
      tier: user.tier,
      counts_toward_limit: user.tier === "creator",
      priority,
    });

    // Update followed_shows
    await sb.from("followed_shows")
      .update({
        last_episode_id: latest.guid,
        last_checked_at: new Date().toISOString(),
      })
      .eq("id", show.id);

    // In-app notification
    await sb.from("notifications").insert({
      user_id: user.id,
      type: "smart_queue_added",
      title: `New ${show.show_name} episode — analyzing now`,
      body: latest.title,
      url: "/",
      read: false,
      created_at: new Date().toISOString(),
    }).catch(() => {});

    // Email: episode queued
    if (user.email) {
      sendEmail({
        to: user.email,
        subject: `⚡ New ${show.show_name} episode — analyzing now`,
        html: smartQueueQueuedEmail({
          showName: show.show_name,
          episodeTitle: latest.title,
        }),
      }).catch(() => {});
    }

    console.log(`[smart-queue] Queued: ${user.email} — ${show.show_name}: ${latest.title}`);
  } catch (err: any) {
    console.error(`[smart-queue] Failed for ${show.show_name}:`, err?.message);
  }
}

function smartQueueQueuedEmail(opts: { showName: string; episodeTitle: string }): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:-apple-system,sans-serif;background:#f4f3ef;margin:0;padding:24px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e0ddd8">
  <div style="background:#0f2027;padding:20px 28px">
    <div style="font-family:Georgia,serif;font-size:22px;color:#fff"><span style="font-weight:400">POD</span>LENS</div>
  </div>
  <div style="padding:28px">
    <div style="font-size:22px;font-weight:700;color:#0f2027;margin-bottom:14px">⚡ New episode found</div>
    <div style="background:#f8f8f6;border-radius:6px;padding:14px 16px;margin-bottom:14px;border:1px solid #e0ddd8">
      <div style="font-size:12px;color:#888;margin-bottom:4px">${opts.showName}</div>
      <div style="font-size:15px;font-weight:600;color:#0f2027">${opts.episodeTitle}</div>
    </div>
    <p style="font-size:14px;color:#444;line-height:1.65">Your Smart Queue picked this up. Analysis is running now — you'll get another notification when the full bias report is ready.</p>
    <a style="display:inline-block;background:#0f2027;color:#fff;text-decoration:none;padding:12px 24px;border-radius:4px;font-size:14px;font-weight:600;margin:8px 0 18px" href="https://podlens.app">Go to Podlens →</a>
    <p style="font-size:12px;color:#999">Smart Queue is on because you enabled it in Settings. <a href="https://podlens.app/settings" style="color:#999">Manage</a></p>
  </div>
  <div style="padding:18px 28px;background:#f4f3ef;font-size:11px;color:#aaa;text-align:center;border-top:1px solid #e0ddd8">
    Podlens · podlens.app · hello@podlens.app
  </div>
</div>
</body></html>`;
}

async function runSmartQueueCheck(): Promise<{ sqQueued: number; sqErrors: number }> {
  const sb = getSupabaseAdmin();
  if (!sb) return { sqQueued: 0, sqErrors: 0 };

  let sqQueued = 0;
  let sqErrors = 0;

  try {
    const { data: sqUsers } = await sb
      .from("users")
      .select("id, email, tier")
      .eq("smart_queue_enabled", true)
      .in("tier", ["creator", "operator", "studio"]);

    if (!sqUsers?.length) return { sqQueued: 0, sqErrors: 0 };

    console.log(`[smart-queue] Checking ${sqUsers.length} users`);

    for (const user of sqUsers) {
      const maxShows = user.tier === "creator" ? 5 : user.tier === "operator" ? 20 : 999;

      const { data: shows } = await sb
        .from("followed_shows")
        .select("id, show_name, feed_url, last_episode_id, last_episode_guid")
        .eq("user_id", user.id)
        .eq("smart_queue", true)
        .order("created_at", { ascending: true })
        .limit(maxShows);

      for (const show of (shows || [])) {
        try {
          await checkShowForSmartQueue(sb, user, show);
          sqQueued++;
        } catch {
          sqErrors++;
        }
        // Throttle to avoid hammering RSS feeds
        await new Promise(r => setTimeout(r, 400));
      }
    }
  } catch (err: any) {
    console.error("[smart-queue] Fatal:", err?.message);
  }

  return { sqQueued, sqErrors };
}

// ── Main handler ─────────────────────────────────────────────────────────────

export default async (_req: Request) => {
  const [blobsResult, sqResult] = await Promise.all([
    runBlobsCheck(),
    runSmartQueueCheck(),
  ]);

  return new Response(JSON.stringify({
    ok: true,
    ...blobsResult,
    sqQueued: sqResult.sqQueued,
    sqErrors: sqResult.sqErrors,
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = { schedule: "0 */6 * * *" };
