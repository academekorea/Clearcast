import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { getSupabaseAdmin } from "./lib/supabase.js";
import { verifyOTPHash, checkRateLimit, getClientIp, rateLimitResponse } from "./lib/security.js";

async function sha256hex(email: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json" }
  });
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const clientIp = getClientIp(req);
  const rl = await checkRateLimit(clientIp, "change-email", 5, 600);
  if (!rl.allowed) return rateLimitResponse(rl.resetIn);

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { userId, currentEmail, newEmail, code } = body;

  if (!userId || !currentEmail || !newEmail || !code) {
    return json({ error: "userId, currentEmail, newEmail, and code are required" }, 400);
  }
  if (!String(newEmail).includes("@")) return json({ error: "Invalid new email" }, 400);
  if (String(newEmail).toLowerCase() === String(currentEmail).toLowerCase()) {
    return json({ error: "New email must differ from current" }, 400);
  }

  // Verify OTP — code was sent to the NEW email so we look up by newEmail hash
  const store = getStore("podlens-auth");
  const emailHash = await sha256hex(String(newEmail).toLowerCase());
  const key = `otp-${emailHash}`;

  let record: any = null;
  try { record = await store.get(key, { type: "json" }); } catch {}
  if (!record) return json({ error: "No code found. Request a new one." }, 400);
  if (new Date() > new Date(record.expiresAt)) {
    try { await store.delete(key); } catch {}
    return json({ error: "Code expired. Request a new one." }, 400);
  }
  if (record.used) return json({ error: "Code already used. Request a new one." }, 400);
  if (record.purpose && record.purpose !== "change_email") {
    return json({ error: "Code was not issued for email change." }, 400);
  }

  record.attempts = (record.attempts || 0) + 1;
  if (record.attempts > 5) {
    try { await store.delete(key); } catch {}
    return json({ error: "Too many attempts. Request a new code." }, 429);
  }
  await store.setJSON(key, record).catch(() => {});

  let valid = false;
  if (record.hashedCode) valid = await verifyOTPHash(String(code).trim(), record.hashedCode);
  else valid = record.code === String(code).trim();

  if (!valid) {
    return json({ error: "Incorrect code. " + Math.max(0, 5 - record.attempts) + " attempts remaining." }, 400);
  }

  // Mark OTP used
  record.used = true;
  await store.setJSON(key, record).catch(() => {});

  // Update Supabase users table
  const sb = getSupabaseAdmin();
  if (!sb) return json({ error: "Database unavailable" }, 503);

  // Check if newEmail is already taken by another user
  try {
    const existing = await sb
      .from("users")
      .select("id")
      .eq("email", String(newEmail).toLowerCase())
      .neq("id", userId)
      .limit(1);
    if ((existing.data || []).length > 0) {
      return json({ error: "That email is already in use." }, 409);
    }
  } catch (e) {
    console.error("[change-email] existence check failed:", e);
  }

  const { error } = await sb
    .from("users")
    .update({ email: String(newEmail).toLowerCase(), updated_at: new Date().toISOString() })
    .eq("id", userId);

  if (error) {
    console.error("[change-email] update failed:", error);
    return json({ error: "Failed to update email. Please try again." }, 500);
  }

  return json({ ok: true, email: String(newEmail).toLowerCase() });
};

export const config: Config = { path: "/api/change-email" };
