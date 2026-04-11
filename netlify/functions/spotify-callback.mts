import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const BASE_URL = "https://podlens.app";

export default async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state") || "{}";
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return Response.redirect(`${BASE_URL}/?spotify_error=access_denied`, 302);
  }

  let state: any = {};
  try { state = JSON.parse(decodeURIComponent(stateParam)); } catch {}

  const clientId = Netlify.env.get("SPOTIFY_CLIENT_ID");
  const clientSecret = Netlify.env.get("SPOTIFY_CLIENT_SECRET");
  const redirectUri = "https://podlens.app/auth/spotify/callback";

  if (!code || !clientId || !clientSecret) {
    return Response.redirect(`${BASE_URL}/?spotify_error=missing_config`, 302);
  }

  // Exchange authorization code for access token
  let tokenData: any;
  try {
    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${clientId}:${clientSecret}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }).toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenRes.ok) return Response.redirect(`${BASE_URL}/?spotify_error=token_failed`, 302);
    tokenData = await tokenRes.json();
  } catch {
    return Response.redirect(`${BASE_URL}/?spotify_error=token_timeout`, 302);
  }

  const { access_token, refresh_token, expires_in } = tokenData;

  // Fetch Spotify user profile
  let profile: any;
  try {
    const profileRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${access_token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!profileRes.ok) return Response.redirect(`${BASE_URL}/?spotify_error=profile_failed`, 302);
    profile = await profileRes.json();
  } catch {
    return Response.redirect(`${BASE_URL}/?spotify_error=profile_timeout`, 302);
  }

  const spotifyUserId = profile.id || "";
  const spotifyEmail = profile.email || "";
  const spotifyDisplayName = profile.display_name || "";
  const spotifyAvatar = profile.images?.[0]?.url || "";

  const store = getStore("podlens-cache");
  const action = state.action || "login";
  const now = Date.now();

  const storedToken = {
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt: now + (expires_in * 1000),
    spotifyUserId,
    spotifyEmail,
    storedAt: now,
  };

  // ── CONNECT flow: link Spotify to existing Podlens account ──
  if (action === "connect" && state.userId) {
    try { await store.setJSON(`spotify-token-${state.userId}`, storedToken); } catch {}
    return Response.redirect(`${BASE_URL}/settings?connected=spotify`, 302);
  }

  // ── LOGIN / SIGNUP flow ──
  const userStore = getStore("podlens-users");
  let userData: any = null;

  // Look up by Spotify ID first, then by email
  try { userData = await userStore.get(`spotify-${spotifyUserId}`, { type: "json" }); } catch {}
  if (!userData && spotifyEmail) {
    const emailKey = `email-${spotifyEmail.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
    try { userData = await userStore.get(emailKey, { type: "json" }); } catch {}
  }

  let isNewUser = false;
  if (!userData) {
    isNewUser = true;
    const uid = `u-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const trialEndsAt = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
    userData = {
      id: uid,
      name: spotifyDisplayName || (spotifyEmail ? spotifyEmail.split("@")[0] : "Listener"),
      email: spotifyEmail,
      avatar: spotifyAvatar,
      plan: "free",
      signupDate: new Date(now).toISOString(),
      trialEndsAt,
      analysesThisWeek: 0,
      weekResetDate: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
      spotifyId: spotifyUserId,
      authProvider: "spotify",
      joinedAt: now,
    };
    try {
      await userStore.setJSON(`spotify-${spotifyUserId}`, userData);
      if (spotifyEmail) {
        const emailKey = `email-${spotifyEmail.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
        await userStore.setJSON(emailKey, userData);
      }
    } catch {}
  }

  // Store Spotify token for this Podlens user
  try { await store.setJSON(`spotify-token-${userData.id}`, storedToken); } catch {}

  // Pass minimal user data back to frontend via URL param
  const loginPayload = encodeURIComponent(JSON.stringify({
    id: userData.id,
    name: userData.name,
    email: userData.email,
    avatar: userData.avatar || spotifyAvatar,
    plan: userData.plan,
    signupDate: userData.signupDate,
    trialEndsAt: userData.trialEndsAt,
    analysesThisWeek: userData.analysesThisWeek || 0,
    weekResetDate: userData.weekResetDate,
    joinedAt: userData.joinedAt,
    authProvider: "spotify",
    isNewUser,
  }));

  return Response.redirect(`${BASE_URL}/?spotify_login=${loginPayload}`, 302);
};

export const config: Config = { path: "/auth/spotify/callback" };
