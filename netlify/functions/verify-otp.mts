import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

function hashEmail(email: string): string {
  let h = 5381;
  for (let i = 0; i < email.length; i++) h = ((h << 5) + h) ^ email.charCodeAt(i);
  return Math.abs(h).toString(36);
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { email, code, purpose } = body;

  if (!email || !code) return json({ error: "email and code required" }, 400);

  const store = getStore("podlens-auth");
  const key = `otp-${hashEmail(email.toLowerCase())}`;

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

  // Verify code
  if (record.code !== String(code).trim()) {
    return json({ error: "Incorrect code. " + (5 - record.attempts) + " attempts remaining." }, 400);
  }

  // Purpose check (optional)
  if (purpose && record.purpose !== purpose) {
    return json({ error: "Code was not issued for this purpose." }, 400);
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
