import type { Config } from "@netlify/functions";
import webpush from "web-push";
import { getSupabaseAdmin } from "./lib/supabase.js";

// POST /api/push-subscribe  — save a push subscription for a user
// DELETE /api/push-subscribe — remove a push subscription

export default async (req: Request) => {
  const vapidPublic = Netlify.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Netlify.env.get("VAPID_PRIVATE_KEY");

  // GET — return public VAPID key for client-side subscription setup
  if (req.method === "GET") {
    return new Response(JSON.stringify({ vapidPublicKey: vapidPublic || null }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST" && req.method !== "DELETE") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!vapidPublic || !vapidPrivate) {
    return new Response(JSON.stringify({ error: "Push notifications not configured" }), {
      status: 503, headers: { "Content-Type": "application/json" },
    });
  }

  webpush.setVapidDetails(
    "mailto:hello@podlens.app",
    vapidPublic,
    vapidPrivate
  );

  try {
    const body = await req.json();
    const { userId, subscription } = body;

    if (!userId) {
      return new Response(JSON.stringify({ error: "userId required" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const sb = getSupabaseAdmin();
    if (!sb) {
      return new Response(JSON.stringify({ error: "Database not configured" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    if (req.method === "DELETE") {
      // Remove subscription by endpoint
      const endpoint = subscription?.endpoint;
      if (endpoint) {
        await sb.from("push_subscriptions")
          .delete()
          .eq("user_id", userId)
          .eq("endpoint", endpoint)
          .catch(() => {});
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // POST — save subscription
    if (!subscription?.endpoint || !subscription?.keys) {
      return new Response(JSON.stringify({ error: "Invalid subscription object" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    await sb.from("push_subscriptions").upsert({
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      created_at: new Date().toISOString(),
    }, { onConflict: "endpoint" });

    // Send a welcome push to confirm it works
    try {
      await webpush.sendNotification(
        subscription,
        JSON.stringify({
          title: "PODLENS",
          body: "Push notifications enabled — we'll let you know when new analyses are ready.",
          icon: "/favicon.svg",
          url: "https://podlens.app",
        })
      );
    } catch { /* non-critical */ }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Push subscribe failed" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/push-subscribe" };
