import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { verifyOTPHash, checkRateLimit, getClientIp, rateLimitResponse } from "./lib/security.js";

async function sha256hex(email: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const clientIp = getClientIp(req);

  // Rate limit: max 10 verification attempts per minute per IP
  const rl = await checkRateLimit(clientIp, "verify-otp", 10, 60);
  if (!rl.allowed) return rateLimitResponse(rl.resetIn);

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { email, code, purpose } = body;

  if (!email || !code) return json({ error: "email and code required" }, 400);

  const store = getStore("podlens-auth");
  const emailHash = await sha256hex(email.toLowerCase());
  const key = `otp-${emailHash}`;

  let record: any = null;
  try { record = await store.get(key, { type: "json" }); } catch {}

  if (!record) return json({ error: "No code found. Please request a new one." }, 400);

  // Check expiry
  if (new Date() > new Date(record.expiresAt)) {
    try { await store.delete(key); } catch {}
    return json({ error: "Code expired. Please request a new one." }, 400);
  }

  // Increment attempts
  record.attempts = (record.attempts || 0) + 1;
  if (record.attempts > 5) {
    try { await store.delete(key); } catch {}
    return json({ error: "Too many attempts. Please request a new code." }, 429);
  }
  await store.setJSON(key, record).catch(() => {});

  // Check used
  if (record.used) return json({ error: "Code already used. Please request a new one." }, 400);

  // Purpose check (optional)
  if (purpose && record.purpose !== purpose) {
    return json({ error: "Code was not issued for this purpose." }, 400);
  }

  // Verify code — supports both hashed (new) and plaintext (legacy migration)
  let valid = false;
  if (record.hashedCode) {
    valid = await verifyOTPHash(String(code).trim(), record.hashedCode);
  } else {
    // Legacy: codes issued before hash migration
    valid = record.code === String(code).trim();
  }

  if (!valid) {
    return json(
      { error: "Incorrect code. " + Math.max(0, 5 - record.attempts) + " attempts remaining." },
      400
    );
  }

  // Mark used
  record.used = true;
  await store.setJSON(key, record).catch(() => {});

  return json({ ok: true, email: record.email, purpose: record.purpose });
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json" }
  });
}

export const config: Config = { path: "/api/verify-otp" };
