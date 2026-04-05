import type { Config } from "@netlify/functions";

// Web push notifications are currently disabled (VAPID keys not configured).
// GET returns vapidPublicKey: null — client skips subscription setup.
// POST/DELETE return 503 Service Unavailable gracefully.

export default async (req: Request) => {
  if (req.method === "GET") {
    return new Response(JSON.stringify({ vapidPublicKey: null, disabled: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ error: "Push notifications not configured" }),
    { status: 503, headers: { "Content-Type": "application/json" } }
  );
};

export const config: Config = { path: "/api/push-subscribe" };
