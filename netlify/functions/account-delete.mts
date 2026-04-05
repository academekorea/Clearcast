import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const SB_URL = "https://suqjdctajnitxivczjtg.supabase.co";
const STRIPE_SECRET = () => Netlify.env.get("STRIPE_SECRET_KEY") || "";

function sbHeaders(): HeadersInit {
  const key = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { userId, email, reason } = body;

  if (!userId || !email) return json({ error: "userId and email required" }, 400);

  // 1. Look up user in Supabase
  let userData: any = null;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}&select=*`, {
      headers: sbHeaders(), signal: AbortSignal.timeout(8000)
    });
    if (res.ok) {
      const rows = await res.json();
      userData = rows[0] || null;
    }
  } catch {}

  // 2. Cancel Stripe subscription if active
  if (userData?.stripe_customer_id && STRIPE_SECRET()) {
    try {
      // Find active subscriptions
      const listRes = await fetch(
        `https://api.stripe.com/v1/subscriptions?customer=${userData.stripe_customer_id}&status=active`,
        {
          headers: { Authorization: `Bearer ${STRIPE_SECRET()}` },
          signal: AbortSignal.timeout(8000)
        }
      );
      if (listRes.ok) {
        const list = await listRes.json();
        for (const sub of list.data || []) {
          await fetch(`https://api.stripe.com/v1/subscriptions/${sub.id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${STRIPE_SECRET()}` },
            signal: AbortSignal.timeout(8000)
          }).catch(() => {});
        }
      }
    } catch {}
  }

  // 3. Delete from Supabase (cascade will handle related tables if set up)
  const tables = ["analyses", "events", "usage", "followed_shows", "connected_accounts", "user_devices", "subscriptions", "notifications", "downloads"];
  for (const table of tables) {
    try {
      await fetch(`${SB_URL}/rest/v1/${table}?user_id=eq.${userId}`, {
        method: "DELETE", headers: sbHeaders(), signal: AbortSignal.timeout(5000)
      });
    } catch {}
  }
  try {
    await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}`, {
      method: "DELETE", headers: sbHeaders(), signal: AbortSignal.timeout(5000)
    });
  } catch {}

  // 4. Delete from Netlify Blobs
  const userStore = getStore("podlens-users");
  try { await userStore.delete(userId); } catch {}

  // 5. Log deletion event
  try {
    await fetch(`${SB_URL}/rest/v1/events`, {
      method: "POST",
      headers: sbHeaders(),
      body: JSON.stringify({
        type: "account_deleted",
        user_id: userId,
        properties: JSON.stringify({ email: email.replace(/(.{2}).+(@.+)/, "$1***$2"), reason: reason || "user_request" }),
        created_at: new Date().toISOString()
      }),
      signal: AbortSignal.timeout(5000)
    });
  } catch {}

  return json({ ok: true, message: "Account deleted. Sorry to see you go." });
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json" }
  });
}

export const config: Config = { path: "/api/account-delete" };
