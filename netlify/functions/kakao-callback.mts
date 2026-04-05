import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export default async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const errorParam = url.searchParams.get("error");

  if (errorParam || !code) {
    return Response.redirect("/?kakao_error=access_denied", 302);
  }

  const appKey = Netlify.env.get("KAKAO_APP_KEY");
  const redirectUri = "https://podlens.app/auth/kakao/callback";

  if (!appKey) {
    return Response.redirect("/?kakao_error=missing_config", 302);
  }

  // Exchange authorization code for access token
  let tokenData: any;
  try {
    const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: appKey,
        redirect_uri: redirectUri,
        code,
      }).toString(),
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
      weekResetDate: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
      kakaoId,
      authProvider: "kakao",
      joinedAt: now,
    };
    try {
      await userStore.setJSON(`kakao-${kakaoId}`, userData);
      if (kakaoEmail) {
        const emailKey = `email-${kakaoEmail.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
        await userStore.setJSON(emailKey, userData);
      }
    } catch {}
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
    weekResetDate: userData.weekResetDate,
    joinedAt: userData.joinedAt,
    authProvider: "kakao",
    isNewUser,
  }));

  return Response.redirect(`/?kakao_login=${loginPayload}`, 302);
};

export const config: Config = { path: "/auth/kakao/callback" };
