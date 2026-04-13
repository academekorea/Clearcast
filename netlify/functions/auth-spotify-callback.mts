import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { sbUpsert, trackEvent } from "./lib/supabase.js";

// Spotify OAuth callback — exchanges code for tokens
// Stores in Supabase connected_accounts + Netlify Blobs cache

export default async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state'); // userId encoded in state
  const error = url.searchParams.get('error');

  if (error || !code) {
    return Response.redirect(`https://podlens.app/?spotify=error&msg=${encodeURIComponent(error || 'cancelled')}`, 302);
  }

  const clientId = Netlify.env.get('SPOTIFY_CLIENT_ID');
  const clientSecret = Netlify.env.get('SPOTIFY_CLIENT_SECRET');
  const redirectUri = 'https://podlens.app/auth/spotify/callback';

  if (!clientId || !clientSecret) {
    return Response.redirect('https://podlens.app/?spotify=error&msg=config', 302);
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + btoa(clientId + ':' + clientSecret),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      return Response.redirect('https://podlens.app/?spotify=error&msg=token_exchange', 302);
    }

    const tokens = await tokenRes.json();
    const { access_token, refresh_token, expires_in } = tokens;
    const expiresAt = new Date(Date.now() + (expires_in || 3600) * 1000).toISOString();

    // Get Spotify user ID
    const profileRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${access_token}` },
    });
    const profile = profileRes.ok ? await profileRes.json() : {};
    const spotifyUserId = profile.id || '';
    const spotifyDisplayName = profile.display_name || '';
    const spotifyEmail = profile.email || '';
    const isPremium = profile.product === 'premium';

    // Parse userId from state param
    const userId = state || null;

    // Write to Supabase connected_accounts
    if (userId) {
      await sbUpsert('connected_accounts', {
        user_id: userId,
        provider: 'spotify',
        access_token,
        refresh_token: refresh_token || null,
        expires_at: expiresAt,
        provider_user_id: spotifyUserId,
        provider_username: spotifyDisplayName,
        provider_email: spotifyEmail,
        metadata: JSON.stringify({ isPremium }),
        updated_at: new Date().toISOString(),
      });

      trackEvent(userId, 'spotify_connected', { is_premium: isPremium });
    }

    // Also cache in Netlify Blobs
    if (userId) {
      try {
        const store = getStore('podlens-users');
        await store.setJSON(`spotify-${userId}`, {
          accessToken: access_token,
          refreshToken: refresh_token || null,
          expiresAt,
          spotifyUserId,
          spotifyDisplayName,
          isPremium,
          connectedAt: new Date().toISOString(),
        });
      } catch { /* non-critical */ }
    }

    // Redirect back to settings with success
    const params = new URLSearchParams({
      spotify: 'connected',
      display_name: spotifyDisplayName,
      is_premium: String(isPremium),
    });
    return Response.redirect(`https://podlens.app/?${params}`, 302);

  } catch (e: any) {
    console.error('Spotify callback error:', e);
    return Response.redirect('https://podlens.app/?spotify=error&msg=server', 302);
  }
};

export const config: Config = { path: '/auth/spotify/callback' };
