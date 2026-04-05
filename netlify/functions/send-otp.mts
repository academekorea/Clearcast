import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { sendEmail } from "./lib/email.js";

function hashEmail(email: string): string {
  let h = 5381;
  for (let i = 0; i < email.length; i++) h = ((h << 5) + h) ^ email.charCodeAt(i);
  return Math.abs(h).toString(36);
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { email, purpose = "verification" } = body;

  if (!email || !email.includes("@")) {
    return json({ error: "Valid email required" }, 400);
  }

  const store = getStore("podlens-auth");
  const key = `otp-${hashEmail(email.toLowerCase())}`;

  // Rate limit: max 3 OTPs per 10 minutes
  try {
    const existing = await store.get(key, { type: "json" }) as any;
    if (existing && existing.attempts >= 3 && Date.now() - new Date(existing.createdAt).getTime() < 600_000) {
      return json({ error: "Too many codes sent. Please wait 10 minutes." }, 429);
    }
  } catch {}

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await store.setJSON(key, {
    code,
    email: email.toLowerCase(),
    purpose,
    expiresAt,
    createdAt: new Date().toISOString(),
    used: false,
    attempts: 0,
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
        <p style="font-size:13px;color:#888;margin:0">This code expires in 10 minutes. Never share it with anyone.<br>If you didn't request this, you can safely ignore this email.</p>
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
