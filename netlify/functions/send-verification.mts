import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { sendEmail } from "./lib/email.js";

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

function verificationEmailHtml(name: string, verifyUrl: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;background:#f4f3ef;margin:0;padding:24px}
.wrap{max-width:520px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e0ddd8}
.top{background:#0f2027;padding:20px 28px}.logo{font-family:Georgia,serif;font-size:22px;font-weight:700;color:#fff}
.logo span{font-weight:400}.content{padding:32px}
.h1{font-size:22px;font-weight:700;color:#0f2027;margin:0 0 12px}
p{font-size:14px;color:#444;line-height:1.65;margin:0 0 14px}
.btn{display:inline-block;background:#0f2027;color:#fff!important;text-decoration:none;padding:14px 28px;border-radius:6px;font-size:15px;font-weight:600;margin:8px 0 20px}
.muted{font-size:12px;color:#999}.footer{padding:16px 28px;background:#f4f3ef;font-size:11px;color:#aaa;text-align:center;border-top:1px solid #e0ddd8}
</style></head><body>
<div class="wrap">
  <div class="top"><div class="logo"><span>POD</span>LENS</div></div>
  <div class="content">
    <div class="h1">Confirm your email address</div>
    <p>Hi ${name || "there"} — welcome to Podlens. Click the button below to verify your email and activate your account.</p>
    <a class="btn" href="${verifyUrl}">Verify my email →</a>
    <p class="muted">This link expires in 24 hours. If you didn't sign up for Podlens, you can safely ignore this email.</p>
    <p class="muted">If the button doesn't work, copy this URL into your browser:<br><span style="color:#555;word-break:break-all">${verifyUrl}</span></p>
  </div>
  <div class="footer">Podlens · podlens.app · hello@podlens.app</div>
</div>
</body></html>`;
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { email, name, userId } = body;

  if (!email || !email.includes("@")) {
    return new Response(JSON.stringify({ error: "Valid email required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const store = getStore("podlens-auth");

  // Rate limit: max 3 verification emails per email per hour
  const emailHash = await sha256hex(email.toLowerCase().trim());
  const rateLimitKey = `verify-rate-${emailHash}`;
  try {
    const rateData = await store.get(rateLimitKey, { type: "json" }) as any;
    if (rateData?.count >= 3 && rateData?.resetAt && Date.now() < rateData.resetAt) {
      return new Response(JSON.stringify({ error: "Too many verification emails sent. Please check your inbox or try again later." }), {
        status: 429, headers: { "Content-Type": "application/json" },
      });
    }
  } catch {}

  // Generate token (24h expiry)
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, "0")).join("");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await store.setJSON(`verify-${token}`, {
    email: email.toLowerCase().trim(),
    userId: userId || null,
    expiresAt,
    used: false,
    createdAt: new Date().toISOString(),
  });

  // Update rate limit
  try {
    const rateData = await store.get(rateLimitKey, { type: "json" }) as any || {};
    await store.setJSON(rateLimitKey, {
      count: (rateData.count || 0) + 1,
      resetAt: rateData.resetAt || Date.now() + 60 * 60 * 1000,
    });
  } catch {}

  const verifyUrl = `https://podlens.app/api/verify-email?token=${token}`;

  // Send email
  const emailSent = await sendEmail({
    to: email,
    subject: "Confirm your Podlens account",
    html: verificationEmailHtml(name || "", verifyUrl),
  });

  if (!emailSent) {
    return new Response(JSON.stringify({ error: "Failed to send verification email. Please try again." }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true, message: "Verification email sent" }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = { path: "/api/send-verification" };
