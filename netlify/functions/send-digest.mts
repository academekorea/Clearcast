import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Weekly Bias Digest — sends Monday 9am to all Creator+ subscribers
// Triggered by Netlify scheduled function or external cron
// Email delivery is stubbed until an email provider (Postmark/SendGrid) is wired in

function getWeekNumber(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${week}`;
}

export default async (req: Request) => {
  // Secure with RATE_LIMIT_SECRET header (used as scheduler auth)
  const secret = Netlify.env.get("RATE_LIMIT_SECRET") || "";
  const authHeader = req.headers.get("x-pl-secret") || "";
  if (secret && authHeader !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const week = getWeekNumber();
  const metaStore = getStore("podlens-meta");

  // Check if digest already sent this week
  try {
    const log = await metaStore.get(`digest-sent-${week}`, { type: "json" }) as any;
    if (log?.sent) {
      return new Response(JSON.stringify({ skipped: true, reason: "already_sent", week }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
  } catch {}

  // Gather this week's analyses from Blobs
  const jobStore = getStore("podlens-jobs");
  const userStore = getStore("podlens-users");

  let digestsSent = 0;
  const errors: string[] = [];

  try {
    // List users with digest subscription
    const userKeys = await userStore.list();
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Monday
    weekStart.setHours(0, 0, 0, 0);

    for (const key of (userKeys.blobs || []).slice(0, 500)) {
      if (!key.key.startsWith("google-") && !key.key.startsWith("kakao-") && !key.key.startsWith("u-")) continue;

      try {
        const user = await userStore.get(key.key, { type: "json" }) as any;
        if (!user?.email || !user?.plan) continue;
        if (!["creator", "operator", "studio"].includes(user.plan)) continue;

        // Check digest prefs
        const prefs = await userStore.get(`digest-prefs-${user.id}`, { type: "json" }).catch(() => null) as any;
        if (prefs?.subscribed === false) continue;

        // Get user's recent analyses (last 7 days)
        const userAnalyses: any[] = [];
        const analyzed = user.analyzedEpisodes || [];
        for (const ep of analyzed.slice(-10)) {
          if (ep.analyzedAt && new Date(ep.analyzedAt) >= weekStart) {
            userAnalyses.push(ep);
          }
        }

        // Build digest content
        const digestContent = {
          userId: user.id,
          email: user.email,
          name: user.name || "Listener",
          plan: user.plan,
          week,
          episodesThisWeek: userAnalyses.length,
          biasFingerprint: user.biasFingerprint || { leftPct: 0, centerPct: 0, rightPct: 0, totalEpisodes: 0 },
          analyses: userAnalyses.slice(0, 5),
        };

        // Store digest for delivery (email provider integration point)
        await userStore.setJSON(`digest-${user.id}-${week}`, {
          ...digestContent,
          createdAt: new Date().toISOString(),
          delivered: false,
        });

        // TODO: integrate with Postmark/SendGrid/Resend here
        // await sendEmail({ to: user.email, subject: "Your Weekly Bias Digest", ... })

        digestsSent++;
      } catch (e: any) {
        errors.push(e?.message || "unknown");
      }
    }

    // Mark digest as sent for this week
    await metaStore.setJSON(`digest-sent-${week}`, {
      sent: true,
      sentAt: new Date().toISOString(),
      count: digestsSent,
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Digest failed" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, week, digestsSent, errors: errors.slice(0, 10) }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = { path: "/api/send-digest" };
