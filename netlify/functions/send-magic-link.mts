import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { sendEmail, magicLinkEmail } from "./lib/email.js";

// POST /api/send-magic-link { email }
// Sends a sign-in link valid for MAGIC_LINK_EXPIRY_MINUTES (default 15)

const LOCKOUT_MAX = 5;
const LOCKOUT_MINUTES = 15;

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: any = {};
  try { body = await req.json(); } catch {}

  const email = (body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return new Response(JSON.stringify({ error: "Valid email required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const expiryMinutes = parseInt("15" || "15", 10);
  const store = getStore("podlens-auth");
  const emailHash = await sha256hex(email);

  // Check lockout
  const lockoutKey = `lockout-${emailHash}`;
  try {
    const lockout = await store.get(lockoutKey, { type: "json" }) as any;
    if (lockout?.lockedUntil && new Date(lockout.lockedUntil).getTime() > Date.now()) {
      const minutesLeft = Math.ceil((new Date(lockout.lockedUntil).getTime() - Date.now()) / 60000);
      return new Response(JSON.stringify({
        error: `Too many attempts. Try again in ${minutesLeft} minute${minutesLeft !== 1 ? "s" : ""}.`,
        locked: true,
      }), { status: 429, headers: { "Content-Type": "application/json" } });
    }
  } catch {}

  // Generate token
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, "0")).join("");

  const magicUrl = `https://podlens.app/api/verify-magic-link?token=${token}`;
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();

  // Store token
  await store.setJSON(`magic-${token}`, {
    email,
    expiresAt,
    used: false,
    createdAt: new Date().toISOString(),
  });

  // Send email
  const name = email.split("@")[0];
  const sent = await sendEmail({
    to: email,
    subject: "Your Podlens sign-in link",
    html: magicLinkEmail({ name, magicUrl, expiryMinutes }),
  });

  if (!sent) {
    return new Response(JSON.stringify({ error: "Could not send email. Please try again." }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, expiresAt }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = { path: "/api/send-magic-link" };
