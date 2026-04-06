import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { sendEmail } from "./lib/email.js";
import { getSupabaseAdmin } from "./lib/supabase.js";

const SB_URL = "https://suqjdctajnitxivczjtg.supabase.co";
const STRIPE_SECRET = () => Netlify.env.get("STRIPE_SECRET_KEY") || "";

function sbHeaders(): HeadersInit {
  const key = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json" },
  });
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { userId, email, reason, confirmed } = body;

  if (!userId || !email) return json({ error: "userId and email required" }, 400);
  if (!confirmed) return json({ error: "confirmed required" }, 400);

  // Fetch user record
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

  const deletionDate = new Date();
  deletionDate.setDate(deletionDate.getDate() + 7);

  // Soft-delete: mark account pending deletion (do NOT delete data yet)
  try {
    await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}`, {
      method: "PATCH",
      headers: sbHeaders(),
      body: JSON.stringify({
        account_status: "pending_deletion",
        deletion_scheduled_at: new Date().toISOString(),
        deletion_date: deletionDate.toISOString(),
        updated_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(8000)
    });
  } catch {}

  // Cancel Stripe subscription immediately
  if (userData?.stripe_customer_id && STRIPE_SECRET()) {
    try {
      const listRes = await fetch(
        `https://api.stripe.com/v1/subscriptions?customer=${userData.stripe_customer_id}&status=active`,
        { headers: { Authorization: `Bearer ${STRIPE_SECRET()}` }, signal: AbortSignal.timeout(8000) }
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

  // Generate recovery token and store in Blobs
  const recoveryToken = crypto.randomUUID();
  try {
    const secStore = getStore("podlens-security");
    await secStore.setJSON(`recovery-${userId}`, {
      userId,
      email,
      expiresAt: deletionDate.toISOString(),
    });
  } catch {}

  // Send confirmation email with recovery link
  const deadline = deletionDate.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });
  const recoveryUrl = `https://podlens.app/settings.html?recover_token=${recoveryToken}&userId=${encodeURIComponent(userId)}`;

  await sendEmail({
    to: email,
    subject: "Your Podlens account is scheduled for deletion",
    html: `
      <div class="h1">Account deletion scheduled</div>
      <p>Your Podlens account is scheduled for permanent deletion on <strong>${deadline}</strong>.</p>
      <div class="warning">Changed your mind? You have 7 days to recover your account and all your data.</div>
      <a class="btn" href="${recoveryUrl}">Recover my account &rarr;</a>
      <p class="muted">If you didn't request this, your account may have been compromised. Please contact us at hello@podlens.app</p>
    `,
  }).catch(() => {});

  // Log deletion event
  try {
    await fetch(`${SB_URL}/rest/v1/events`, {
      method: "POST",
      headers: sbHeaders(),
      body: JSON.stringify({
        user_id: userId,
        event_type: "account_deletion_scheduled",
        properties: { email: email.replace(/(.{2}).+(@.+)/, "$1***$2"), reason: reason || "user_request" },
        created_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(5000)
    });
  } catch {}

  return json({ ok: true, deletion_date: deletionDate.toISOString() });
};

export const config: Config = { path: "/api/account-delete" };
