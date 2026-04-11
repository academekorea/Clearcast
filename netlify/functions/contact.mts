import type { Config } from "@netlify/functions";
import { sendEmail } from "./lib/email.js";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: { firstName?: string; lastName?: string; email?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const { firstName = "", lastName = "", email = "", message = "" } = body;

  // Basic validation
  if (!firstName.trim() || !email.trim() || !message.trim()) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return new Response(JSON.stringify({ error: "Invalid email address" }), { status: 400 });
  }

  const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;background:#f4f3ef;margin:0;padding:24px}
.wrap{max-width:520px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e0ddd8}
.top{background:#0f2027;padding:20px 28px}
.logo{font-family:Georgia,serif;font-size:22px;font-weight:700;color:#fff;letter-spacing:.05em}
.logo span{font-weight:400}
.content{padding:28px}
.h1{font-size:20px;font-weight:700;color:#0f2027;margin:0 0 16px}
.row{margin-bottom:12px;font-size:14px;color:#444;line-height:1.5}
.label{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#999;margin-bottom:3px}
.value{color:#111}
.message-box{background:#f8f8f6;border-radius:6px;padding:14px 16px;margin-top:4px;font-size:14px;color:#333;line-height:1.65;border:1px solid #e0ddd8;white-space:pre-wrap}
.footer{padding:16px 28px;background:#f4f3ef;font-size:11px;color:#aaa;text-align:center;border-top:1px solid #e0ddd8}
.reply-btn{display:inline-block;background:#0f2027;color:#fff!important;text-decoration:none;padding:10px 20px;border-radius:4px;font-size:13px;font-weight:600;margin-top:16px}
</style></head><body>
<div class="wrap">
  <div class="top"><div class="logo"><span>POD</span>LENS</div></div>
  <div class="content">
    <div class="h1">New contact form submission</div>
    <div class="row">
      <div class="label">From</div>
      <div class="value">${fullName}</div>
    </div>
    <div class="row">
      <div class="label">Email</div>
      <div class="value"><a href="mailto:${email.trim()}" style="color:#0f2027">${email.trim()}</a></div>
    </div>
    <div class="row">
      <div class="label">Message</div>
      <div class="message-box">${message.trim().replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
    </div>
    <a class="reply-btn" href="mailto:${email.trim()}?subject=Re: Your message to Podlens">Reply to ${firstName.trim()} →</a>
  </div>
  <div class="footer">Podlens contact form · podlens.app</div>
</div>
</body></html>`;

  const sent = await sendEmail({
    to: "hello@podlens.app",
    subject: `Contact: ${fullName} <${email.trim()}>`,
    html,
  });

  if (!sent) {
    return new Response(JSON.stringify({ error: "Failed to send — please email hello@podlens.app directly" }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export const config: Config = {
  path: "/api/contact",
};
