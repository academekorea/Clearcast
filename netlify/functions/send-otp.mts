import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { sendEmail } from "./lib/email.js";
import { generateOTP, hashOTP, checkRateLimit, getClientIp, rateLimitResponse } from "./lib/security.js";

async function sha256hex(email: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const clientIp = getClientIp(req);

  // Rate limit: max 5 OTP requests per 10 minutes per IP
  const rl = await checkRateLimit(clientIp, "send-otp", 5, 600);
  if (!rl.allowed) return rateLimitResponse(rl.resetIn);

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { email, purpose = "verification" } = body;

  if (!email || !email.includes("@")) {
    return json({ error: "Valid email required" }, 400);
  }

  const store = getStore("podlens-auth");
  const emailHash = await sha256hex(email.toLowerCase());
  const key = `otp-${emailHash}`;

  // Per-email rate limit: max 3 codes per 10 minutes
  try {
    const existing = await store.get(key, { type: "json" }) as any;
    if (
      existing &&
      existing.sendCount >= 3 &&
      Date.now() - new Date(existing.createdAt).getTime() < 600_000
    ) {
      return json({ error: "Too many codes sent. Please wait 10 minutes." }, 429);
    }
  } catch {}

  // Generate cryptographically secure OTP
  const code = generateOTP();
  // Shorten expiry for admin_action (5 min) vs normal (10 min)
  const expiryMs = purpose === "admin_action" ? 5 * 60 * 1000 : 10 * 60 * 1000;
  const expiresAt = new Date(Date.now() + expiryMs).toISOString();

  // Hash OTP before storing — never store plaintext
  const hashedCode = await hashOTP(code);

  await store.setJSON(key, {
    hashedCode,
    email: email.toLowerCase(),
    purpose,
    expiresAt,
    createdAt: new Date().toISOString(),
    used: false,
    attempts: 0,
    sendCount: 1,
  });

  const purposeLabel: Record<string, string> = {
    verification: "Verify your identity",
    delete_account: "Confirm account deletion",
    admin_action: "Confirm admin action",
    data_export: "Confirm data export",
  };

  const subject = purposeLabel[purpose] || "Your Podlens verification code";

  await sendEmail({
    to: email,
    subject,
    html: `
      <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#FAF9F6">
        <div style="font-family:'Georgia',serif;font-size:22px;font-weight:700;color:#0A0F1E;margin-bottom:24px">
          POD<span style="font-weight:400">LENS</span>
        </div>
        <h2 style="font-size:18px;font-weight:700;color:#0A0F1E;margin:0 0 8px">${subject}</h2>
        <p style="font-size:14px;color:#666;margin:0 0 24px">Your one-time code:</p>
        <div style="background:#0A0F1E;color:white;font-size:36px;font-weight:700;text-align:center;padding:24px;border-radius:8px;letter-spacing:8px;margin-bottom:24px">
          ${code}
        </div>
        <p style="font-size:13px;color:#888;margin:0">This code expires in ${purpose === "admin_action" ? "5" : "10"} minutes. Never share it with anyone.<br>If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });

  return json({ ok: true, message: "Code sent. Check your email." });
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json" }
  });
}

export const config: Config = { path: "/api/send-otp" };
