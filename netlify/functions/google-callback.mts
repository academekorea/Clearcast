import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

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

  // Decode the id_token JWT payload (no verification needed — we just fetched it from Google)
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
    // Fallback: fetch profile from userinfo endpoint
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
      weekResetDate: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
      googleId: googleUserId,
      authProvider: "google",
      joinedAt: now,
    };
    try {
      await userStore.setJSON(`google-${googleUserId}`, userData);
      if (googleEmail) {
        const emailKey = `email-${googleEmail.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
        await userStore.setJSON(emailKey, userData);
      }
    } catch {}
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
    weekResetDate: userData.weekResetDate,
    joinedAt: userData.joinedAt,
    authProvider: "google",
    isNewUser,
  }));

  return Response.redirect(`/?google_login=${loginPayload}`, 302);
};

export const config: Config = { path: "/auth/google/callback" };
