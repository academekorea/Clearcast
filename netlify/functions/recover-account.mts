import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { sendEmail } from "./lib/email.js";

const SB_URL = "https://suqjdctajnitxivczjtg.supabase.co";

function sbHeaders(): HeadersInit {
  const key = Netlify.env.get("SUPABASE_SERVICE_KEY") || "";
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
  const { userId, email, recover_token } = body;

  if (!userId) return json({ error: "userId required" }, 400);

  // Verify recovery token if provided
  if (recover_token) {
    try {
      const secStore = getStore("podlens-security");
      const record = await secStore.get(`recovery-${userId}`, { type: "json" }) as any;
      if (!record) return json({ error: "Recovery token not found or expired" }, 400);
      if (record.userId !== userId) return json({ error: "Invalid recovery token" }, 400);
      if (new Date(record.expiresAt) < new Date()) return json({ error: "Recovery window has expired" }, 400);
    } catch {
      return json({ error: "Could not verify recovery token" }, 500);
    }
  }

  // Fetch current account status
  let userData: any = null;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}&select=id,email,account_status,deletion_date`, {
      headers: sbHeaders(), signal: AbortSignal.timeout(8000)
    });
    if (res.ok) {
      const rows = await res.json();
      userData = rows[0] || null;
    }
  } catch {}

  if (!userData) return json({ error: "Account not found" }, 404);

  if (userData.account_status !== "pending_deletion") {
    return json({ error: "Account is not scheduled for deletion" }, 400);
  }

  if (userData.deletion_date && new Date(userData.deletion_date) < new Date()) {
    return json({ error: "Recovery window has expired — account has already been deleted" }, 400);
  }

  // Restore account
  try {
    await fetch(`${SB_URL}/rest/v1/users?id=eq.${userId}`, {
      method: "PATCH",
      headers: sbHeaders(),
      body: JSON.stringify({
        account_status: "active",
        deletion_scheduled_at: null,
        deletion_date: null,
        updated_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(8000)
    });
  } catch {
    return json({ error: "Failed to restore account" }, 500);
  }

  // Clean up recovery token
  try {
    const secStore = getStore("podlens-security");
    await secStore.delete(`recovery-${userId}`);
  } catch {}

  // Send confirmation email
  const userEmail = email || userData.email || "";
  if (userEmail) {
    await sendEmail({
      to: userEmail,
      subject: "✅ Your Podlens account has been recovered",
      html: `
        <div class="h1">Your account is back ✅</div>
        <p>Your Podlens account has been fully recovered. All your analyses and history are intact.</p>
        <a class="btn" href="https://podlens.app">Go to Podlens &rarr;</a>
      `,
    }).catch(() => {});
  }

  return json({ ok: true });
};

export const config: Config = { path: "/api/recover-account" };
