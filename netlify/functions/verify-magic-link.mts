import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { getSupabaseAdmin } from "./lib/supabase.js";
import { isSuperAdmin, applySuperAdminOverrides, superAdminSupabaseFields } from "./lib/admin.js";
import { sendEmail, newDeviceAlertEmail } from "./lib/email.js";

// GET /api/verify-magic-link?token=TOKEN
// Verifies a magic link token and signs in the user

const LOCKOUT_MAX = 5;
const LOCKOUT_MINUTES = 15;

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";

  if (!token) {
    return Response.redirect("/?magic_error=missing_token", 302);
  }

  const store = getStore("podlens-auth");
  const userStore = getStore("podlens-users");

  // Rate-limit by token existence (each token is single-use)
  let tokenData: any;
  try {
    tokenData = await store.get(`magic-${token}`, { type: "json" });
  } catch {}

  if (!tokenData) {
    return Response.redirect("/?magic_error=invalid", 302);
  }

  const email = tokenData.email || "";

  // Check lockout for this email
  const emailHash = await sha256hex(email);
  const lockoutKey = `lockout-${emailHash}`;
  try {
    const lockout = await store.get(lockoutKey, { type: "json" }) as any;
    if (lockout?.lockedUntil && new Date(lockout.lockedUntil).getTime() > Date.now()) {
      return Response.redirect("/?magic_error=locked", 302);
    }
  } catch {}

  // Validate token
  if (tokenData.used) {
    return Response.redirect("/?magic_error=used", 302);
  }
  if (new Date(tokenData.expiresAt).getTime() < Date.now()) {
    await store.delete(`magic-${token}`);
    return Response.redirect("/?magic_error=expired", 302);
  }

  // Mark used
  try {
    await store.setJSON(`magic-${token}`, { ...tokenData, used: true, usedAt: new Date().toISOString() });
  } catch {}

  // Clear lockout on success
  try { await store.delete(lockoutKey); } catch {}

  // Find or create user
  const now = Date.now();
  let userData: any = null;
  const emailKey = `email-${email.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
  try { userData = await userStore.get(emailKey, { type: "json" }); } catch {}

  const isNewUser = !userData;
  if (!userData) {
    const uid = `u-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const trialEndsAt = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
    userData = {
      id: uid,
      email,
      name: email.split("@")[0],
      plan: "free",
      signupDate: new Date(now).toISOString(),
      trialEndsAt,
      analysesThisWeek: 0,
      analysesThisMonth: 0,
      monthResetDate: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
      weekResetDate: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
      authProvider: "magic",
      joinedAt: now,
    };
    try {
      await userStore.setJSON(emailKey, userData);
    } catch {}
  }

  // Super admin override
  if (isSuperAdmin(email)) {
    applySuperAdminOverrides(userData, email);
    try { await userStore.setJSON(emailKey, userData); } catch {}
  }

  // Upsert to Supabase
  const sb = getSupabaseAdmin();
  if (sb) {
    const supaFields: Record<string, unknown> = {
      id: userData.id,
      email,
      name: userData.name,
      provider: 'magic',
      tier: userData.plan || 'free',
      created_at: userData.signupDate || new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    };
    if (isSuperAdmin(email)) Object.assign(supaFields, superAdminSupabaseFields());
    sb.from('users').upsert(supaFields, { onConflict: 'id' }).then(() => {}).catch(() => {});
  }

  // New device detection
  const userAgent = req.headers.get("user-agent") || "";
  const deviceFingerprint = await sha256hex(userAgent.slice(0, 200));
  const deviceKey = `device-${userData.id}-${deviceFingerprint}`;
  try {
    const knownDevice = await userStore.get(deviceKey, { type: "json" });
    if (!knownDevice) {
      // New device — store it and send alert (if not a brand new user)
      await userStore.setJSON(deviceKey, {
        firstSeen: new Date().toISOString(),
        userAgent: userAgent.slice(0, 200),
      });
      if (!isNewUser && userData.email) {
        const deviceInfo = userAgent.slice(0, 100) || "Unknown device";
        sendEmail({
          to: userData.email,
          subject: "New sign-in to your Podlens account",
          html: newDeviceAlertEmail({
            name: userData.name || "",
            deviceInfo,
            location: "Unknown",
            time: new Date().toLocaleString("en-US", { timeZone: "UTC" }) + " UTC",
            secureUrl: "https://podlens.app/settings#security",
          }),
        }).catch(() => {});
      }
    }
  } catch {}

  const loginPayload = encodeURIComponent(JSON.stringify({
    id: userData.id,
    name: userData.name,
    email: userData.email,
    plan: userData.plan,
    signupDate: userData.signupDate,
    trialEndsAt: userData.trialEndsAt,
    analysesThisWeek: userData.analysesThisWeek || 0,
    analysesThisMonth: userData.analysesThisMonth || 0,
    weekResetDate: userData.weekResetDate,
    monthResetDate: userData.monthResetDate,
    joinedAt: userData.joinedAt,
    authProvider: "magic",
    isNewUser,
    isSuperAdmin: isSuperAdmin(email),
    foundingMember: userData.foundingMember || false,
    foundingMemberSince: userData.foundingMemberSince || null,
    pilotMember: userData.pilotMember || false,
    pilotExpiresAt: userData.pilotExpiresAt || null,
  }));

  return Response.redirect(`/?magic_login=${loginPayload}`, 302);
};

export const config: Config = { path: "/api/verify-magic-link" };
