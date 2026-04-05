import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Runs every 24h — checks RSS feeds for new episodes for followed shows
// On new episode: stores notification + (stub) sends email alert to Creator+ users

export default async (req: Request) => {
  const secret = Netlify.env.get("RATE_LIMIT_SECRET") || "";
  const authHeader = req.headers.get("x-pl-secret") || "";
  if (secret && authHeader !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userStore = getStore("podlens-users");
  const metaStore = getStore("podlens-meta");

  let checked = 0;
  let newEpisodesFound = 0;
  const errors: string[] = [];

  try {
    // Gather all show-follow keys
    const allKeys = await userStore.list();
    const followKeys = (allKeys.blobs || []).filter(k => k.key.startsWith("show-follow-"));

    for (const key of followKeys.slice(0, 200)) {
      try {
        const follow = await userStore.get(key.key, { type: "json" }) as any;
        if (!follow?.feedUrl || !follow?.userId) continue;

        // Only check for Creator+ users (show alerts are Creator+)
        const userKey = `u-${follow.userId}` in allKeys ? `u-${follow.userId}` : follow.userId;
        const user = await userStore.get(userKey, { type: "json" }).catch(() => null) as any;
        if (!user || !["creator", "operator", "studio"].includes(user?.plan || "")) continue;

        const feedUrl: string = follow.feedUrl;
        const lastKnownGuid: string = follow.lastKnownGuid || "";
        const showSlug: string = follow.showSlug || "";

        // Fetch RSS feed
        const rssRes = await fetch(feedUrl, { signal: AbortSignal.timeout(8000) });
        if (!rssRes.ok) continue;
        const rssText = await rssRes.text();

        // Parse latest episode GUID from RSS
        const guidMatch = rssText.match(/<guid[^>]*>([^<]+)<\/guid>/);
        const latestGuid = guidMatch?.[1]?.trim() || "";

        // Parse latest episode title
        const titleMatch = rssText.match(/<item[^>]*>[\s\S]*?<title>(?:<!\[CDATA\[)?([^\]<]+)(?:\]\]>)?<\/title>/);
        const latestTitle = titleMatch?.[1]?.trim() || "New Episode";

        checked++;

        if (latestGuid && latestGuid !== lastKnownGuid) {
          newEpisodesFound++;

          // Update stored GUID
          await userStore.setJSON(key.key, {
            ...follow,
            lastKnownGuid: latestGuid,
            lastCheckedAt: new Date().toISOString(),
          });

          // Store notification
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

          // TODO: email alert integration point
          // await sendEmail({ to: user.email, subject: `New episode: ${follow.showName}`, ... })
        } else {
          // Update last checked timestamp even if no new episode
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

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Check failed" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, checked, newEpisodesFound, errors: errors.slice(0, 10) }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = { path: "/api/check-new-episodes" };
