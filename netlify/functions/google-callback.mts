import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { getSupabaseAdmin } from "./lib/supabase.js";
import { isSuperAdmin, applySuperAdminOverrides, superAdminSupabaseFields } from "./lib/admin.js";
import { sendEmail, newDeviceAlertEmail } from "./lib/email.js";

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function assignFoundingStatus(
  userData: any,
  email: string,
  isNewUser: boolean
): Promise<void> {
  if (!isNewUser) return;

  const metaStore = getStore("podlens-meta");

  // Check abuse blocklist
  if (email) {
    const hash = await sha256hex(email.toLowerCase().trim());
    const blockKey = `used-promo-${hash}`;
    try {
      const blocked = await metaStore.get(blockKey, { type: "json" }) as any;
      if (blocked?.foundingUsed) {
        userData.foundingBlocklisted = true;
        return; // Don't assign founding status
      }
    } catch {}
  }

  const now = new Date();
  const foundingEndRaw = Netlify.env.get("FOUNDING_COUPON_END_DATE") || "2026-07-05";
  const foundingMax = parseInt(Netlify.env.get("FOUNDING_MAX_SIGNUPS") || "500", 10);
  const isFoundingPeriod = now < new Date(foundingEndRaw);

  if (!isFoundingPeriod) return;

  // Check + increment founding counter atomically (best-effort)
  let signupCount = 1;
  try {
    const existing = await metaStore.get("founding-signups-count", { type: "json" }) as any;
    signupCount = (existing?.count ?? 0) + 1;
    if (signupCount > foundingMax) return; // Slots full
    await metaStore.setJSON("founding-signups-count", { count: signupCount, updatedAt: now.toISOString() });
  } catch {}

  userData.foundingMember = true;
  userData.foundingMemberSince = now.toISOString();
  userData.signupCount = signupCount;

  // Persist founding status under user ID
  try {
    const userMetaStore = getStore("podlens-users");
    await userMetaStore.setJSON(`founding-${userData.id}`, {
      foundingMember: true,
      foundingMemberSince: now.toISOString(),
      pilotMember: false,
      signupCount,
    });
  } catch {}

  // Write abuse-prevention fingerprint for this email
  if (email) {
    try {
      const hash = await sha256hex(email.toLowerCase().trim());
      await metaStore.setJSON(`used-promo-${hash}`, {
        foundingUsed: true,
        pilotUsed: false,
        deletedAt: null,
        email: hash,
      });
    } catch {}
  }
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state") || "{}";
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return Response.redirect("/?google_error=access_denied", 302);
  }

  let state: any = {};
  try { state = JSON.parse(decodeURIComponent(stateParam)); } catch {}

  const clientId = Netlify.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Netlify.env.get("GOOGLE_CLIENT_SECRET");
  const redirectUri = "https://podlens.app/auth/google/callback";

  if (!code || !clientId || !clientSecret) {
    return Response.redirect("/?google_error=missing_config", 302);
  }

  // Exchange authorization code for access token
  let tokenData: any;
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenRes.ok) return Response.redirect("/?google_error=token_failed", 302);
    tokenData = await tokenRes.json();
  } catch {
    return Response.redirect("/?google_error=token_timeout", 302);
  }

  const { access_token, id_token } = tokenData;

  // Decode the id_token JWT payload
  let profile: any = {};
  try {
    const parts = id_token.split(".");
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    profile = {
      id: payload.sub,
      email: payload.email || "",
      name: payload.name || "",
      avatar: payload.picture || "",
    };
  } catch {
    try {
      const infoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${access_token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (infoRes.ok) profile = await infoRes.json();
    } catch {}
  }

  const googleUserId = profile.id || profile.sub || "";
  const googleEmail = profile.email || "";
  const googleName = profile.name || "";
  const googleAvatar = profile.picture || profile.avatar || "";

  const userStore = getStore("podlens-users");
  let userData: any = null;
  const now = Date.now();

  // Look up by Google ID, then email
  try { userData = await userStore.get(`google-${googleUserId}`, { type: "json" }); } catch {}
  if (!userData && googleEmail) {
    const emailKey = `email-${googleEmail.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
    try { userData = await userStore.get(emailKey, { type: "json" }); } catch {}
  }

  let isNewUser = false;
  if (!userData) {
    isNewUser = true;
    const uid = `u-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const trialEndsAt = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
    userData = {
      id: uid,
      name: googleName || (googleEmail ? googleEmail.split("@")[0] : "Listener"),
      email: googleEmail,
      avatar: googleAvatar,
      plan: "trial",
      signupDate: new Date(now).toISOString(),
      trialEndsAt,
      analysesThisWeek: 0,
      analysesThisMonth: 0,
      monthResetDate: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
      weekResetDate: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
      googleId: googleUserId,
      authProvider: "google",
      joinedAt: now,
    };

    // Assign founding member status
    await assignFoundingStatus(userData, googleEmail, isNewUser);

    // Super admin override
    if (isSuperAdmin(googleEmail)) applySuperAdminOverrides(userData, googleEmail);

    try {
      await userStore.setJSON(`google-${googleUserId}`, userData);
      if (googleEmail) {
        const emailKey = `email-${googleEmail.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
        await userStore.setJSON(emailKey, userData);
      }
    } catch {}
  } else if (isSuperAdmin(googleEmail)) {
    // Returning super admin — always upgrade
    applySuperAdminOverrides(userData, googleEmail);
    try { await userStore.setJSON(`google-${googleUserId}`, userData); } catch {}
  }

  // New device detection (existing users only)
  if (!isNewUser && googleEmail) {
    const ua = req.headers.get("user-agent") || "";
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ua.slice(0, 200)));
    const fp = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    const deviceKey = `device-${userData.id}-${fp}`;
    try {
      const known = await userStore.get(deviceKey, { type: "json" });
      if (!known) {
        await userStore.setJSON(deviceKey, { firstSeen: new Date().toISOString(), userAgent: ua.slice(0, 200) });
        sendEmail({
          to: googleEmail,
          subject: "New sign-in to your Podlens account",
          html: newDeviceAlertEmail({
            name: userData.name || "",
            deviceInfo: ua.slice(0, 100) || "Unknown device",
            location: "Unknown",
            time: new Date().toLocaleString("en-US", { timeZone: "UTC" }) + " UTC",
            secureUrl: "https://podlens.app/settings#security",
          }),
        }).catch(() => {});
      }
    } catch {}
  }

  // Upsert user to Supabase (fire-and-forget)
  const sb = getSupabaseAdmin();
  if (sb) {
    const supaFields: Record<string, unknown> = {
      id: userData.id,
      email: googleEmail,
      name: googleName || userData.name,
      avatar_url: googleAvatar,
      provider: 'google',
      tier: userData.plan || 'trial',
      region: null,
      language: null,
      founding_member: userData.foundingMember || false,
      founding_member_since: userData.foundingMemberSince || null,
      founding_signup_number: userData.signupCount || null,
      pilot_member: userData.pilotMember || false,
      pilot_expires_at: userData.pilotExpiresAt || null,
      created_at: userData.signupDate || new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    };
    if (isSuperAdmin(googleEmail)) Object.assign(supaFields, superAdminSupabaseFields());
    sb.from('users').upsert(supaFields, { onConflict: 'id' }).then(() => {}).catch(() => {});
  }

  const loginPayload = encodeURIComponent(JSON.stringify({
    id: userData.id,
    name: userData.name,
    email: userData.email,
    avatar: userData.avatar || googleAvatar,
    plan: userData.plan,
    signupDate: userData.signupDate,
    trialEndsAt: userData.trialEndsAt,
    analysesThisWeek: userData.analysesThisWeek || 0,
    analysesThisMonth: userData.analysesThisMonth || 0,
    weekResetDate: userData.weekResetDate,
    monthResetDate: userData.monthResetDate,
    joinedAt: userData.joinedAt,
    authProvider: "google",
    isNewUser,
    isSuperAdmin: isSuperAdmin(googleEmail),
    foundingMember: userData.foundingMember || false,
    foundingMemberSince: userData.foundingMemberSince || null,
    signupCount: userData.signupCount || null,
    pilotMember: userData.pilotMember || false,
    pilotExpiresAt: userData.pilotExpiresAt || null,
  }));

  return Response.redirect(`/?google_login=${loginPayload}`, 302);
};

export const config: Config = { path: "/auth/google/callback" };
