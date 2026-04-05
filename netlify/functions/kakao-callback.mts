import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { getSupabaseAdmin } from "./lib/supabase.js";
import { isSuperAdmin, applySuperAdminOverrides, superAdminSupabaseFields } from "./lib/admin.js";

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
    try {
      const blocked = await metaStore.get(`used-promo-${hash}`, { type: "json" }) as any;
      if (blocked?.foundingUsed) {
        userData.foundingBlocklisted = true;
        return;
      }
    } catch {}
  }

  const now = new Date();
  const foundingEndRaw = Netlify.env.get("FOUNDING_COUPON_END_DATE") || "2026-07-05";
  const foundingMax = parseInt(Netlify.env.get("FOUNDING_MAX_SIGNUPS") || "500", 10);
  const isFoundingPeriod = now < new Date(foundingEndRaw);

  if (!isFoundingPeriod) return;

  let signupCount = 1;
  try {
    const existing = await metaStore.get("founding-signups-count", { type: "json" }) as any;
    signupCount = (existing?.count ?? 0) + 1;
    if (signupCount > foundingMax) return;
    await metaStore.setJSON("founding-signups-count", { count: signupCount, updatedAt: now.toISOString() });
  } catch {}

  userData.foundingMember = true;
  userData.foundingMemberSince = now.toISOString();
  userData.signupCount = signupCount;

  try {
    const userMetaStore = getStore("podlens-users");
    await userMetaStore.setJSON(`founding-${userData.id}`, {
      foundingMember: true,
      foundingMemberSince: now.toISOString(),
      pilotMember: false,
      signupCount,
    });
  } catch {}

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
  const errorParam = url.searchParams.get("error");

  if (errorParam || !code) {
    return Response.redirect("/?kakao_error=access_denied", 302);
  }

  const appKey = Netlify.env.get("KAKAO_APP_KEY");
  const clientSecret = Netlify.env.get("KAKAO_CLIENT_SECRET") || "";
  const redirectUri = "https://podlens.app/auth/kakao/callback";

  if (!appKey) {
    return Response.redirect("/?kakao_error=missing_config", 302);
  }

  // Exchange authorization code for access token
  let tokenData: any;
  try {
    const tokenParams: Record<string, string> = {
      grant_type: "authorization_code",
      client_id: appKey,
      redirect_uri: redirectUri,
      code,
    };
    if (clientSecret) tokenParams.client_secret = clientSecret;

    const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(tokenParams).toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenRes.ok) return Response.redirect("/?kakao_error=token_failed", 302);
    tokenData = await tokenRes.json();
  } catch {
    return Response.redirect("/?kakao_error=token_timeout", 302);
  }

  const { access_token } = tokenData;

  // Get Kakao user profile
  let profile: any;
  try {
    const profileRes = await fetch("https://kapi.kakao.com/v2/user/me", {
      headers: { Authorization: `Bearer ${access_token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!profileRes.ok) return Response.redirect("/?kakao_error=profile_failed", 302);
    profile = await profileRes.json();
  } catch {
    return Response.redirect("/?kakao_error=profile_timeout", 302);
  }

  const kakaoId = String(profile.id || "");
  const account = profile.kakao_account || {};
  const kakaoEmail = account.email || "";
  const displayName = profile.properties?.nickname || account.profile?.nickname || "";
  const avatarUrl = profile.properties?.profile_image || account.profile?.profile_image_url || "";

  const userStore = getStore("podlens-users");
  let userData: any = null;
  const now = Date.now();

  // Look up by Kakao ID, then email
  try { userData = await userStore.get(`kakao-${kakaoId}`, { type: "json" }); } catch {}
  if (!userData && kakaoEmail) {
    const emailKey = `email-${kakaoEmail.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
    try { userData = await userStore.get(emailKey, { type: "json" }); } catch {}
  }

  let isNewUser = false;
  if (!userData) {
    isNewUser = true;
    const uid = `u-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const trialEndsAt = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
    userData = {
      id: uid,
      name: displayName || (kakaoEmail ? kakaoEmail.split("@")[0] : "리스너"),
      email: kakaoEmail,
      avatar: avatarUrl,
      plan: "trial",
      signupDate: new Date(now).toISOString(),
      trialEndsAt,
      analysesThisWeek: 0,
      analysesThisMonth: 0,
      monthResetDate: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
      weekResetDate: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
      kakaoId,
      authProvider: "kakao",
      joinedAt: now,
    };

    await assignFoundingStatus(userData, kakaoEmail, isNewUser);

    // Super admin override
    if (isSuperAdmin(kakaoEmail)) applySuperAdminOverrides(userData, kakaoEmail);

    try {
      await userStore.setJSON(`kakao-${kakaoId}`, userData);
      if (kakaoEmail) {
        const emailKey = `email-${kakaoEmail.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
        await userStore.setJSON(emailKey, userData);
      }
    } catch {}
  } else if (isSuperAdmin(kakaoEmail)) {
    applySuperAdminOverrides(userData, kakaoEmail);
    try { await userStore.setJSON(`kakao-${kakaoId}`, userData); } catch {}
  }

  // Upsert user to Supabase (fire-and-forget)
  const sb = getSupabaseAdmin();
  if (sb) {
    const supaFields: Record<string, unknown> = {
      id: userData.id,
      email: kakaoEmail,
      name: userData.name,
      avatar_url: avatarUrl,
      provider: 'kakao',
      tier: userData.plan || 'trial',
      region: 'KR',
      language: 'ko',
      founding_member: userData.foundingMember || false,
      founding_member_since: userData.foundingMemberSince || null,
      founding_signup_number: userData.signupCount || null,
      pilot_member: userData.pilotMember || false,
      pilot_expires_at: userData.pilotExpiresAt || null,
      created_at: userData.signupDate || new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    };
    if (isSuperAdmin(kakaoEmail)) Object.assign(supaFields, superAdminSupabaseFields());
    sb.from('users').upsert(supaFields, { onConflict: 'id' }).then(() => {}).catch(() => {});
  }

  const loginPayload = encodeURIComponent(JSON.stringify({
    id: userData.id,
    name: userData.name,
    email: userData.email,
    avatar: userData.avatar || avatarUrl,
    plan: userData.plan,
    signupDate: userData.signupDate,
    trialEndsAt: userData.trialEndsAt,
    analysesThisWeek: userData.analysesThisWeek || 0,
    analysesThisMonth: userData.analysesThisMonth || 0,
    weekResetDate: userData.weekResetDate,
    monthResetDate: userData.monthResetDate,
    joinedAt: userData.joinedAt,
    authProvider: "kakao",
    isNewUser,
    isSuperAdmin: isSuperAdmin(kakaoEmail),
    foundingMember: userData.foundingMember || false,
    foundingMemberSince: userData.foundingMemberSince || null,
    signupCount: userData.signupCount || null,
    pilotMember: userData.pilotMember || false,
    pilotExpiresAt: userData.pilotExpiresAt || null,
  }));

  return Response.redirect(`/?kakao_login=${loginPayload}`, 302);
};

export const config: Config = { path: "/auth/kakao/callback" };
