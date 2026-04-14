import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { sbUpsert, sbInsert, trackEvent } from "./lib/supabase.js";

// YouTube OAuth callback — Google OAuth with youtube.readonly scope
// Imports subscriptions → followed_shows table

export default async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state'); // userId
  const error = url.searchParams.get('error');

  if (error || !code) {
    return Response.redirect(`https://podlens.app/settings.html?youtube=error&msg=${encodeURIComponent(error || 'cancelled')}`, 302);
  }

  const clientId = Netlify.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Netlify.env.get('GOOGLE_CLIENT_SECRET');
  const redirectUri = 'https://podlens.app/auth/youtube/callback';

  if (!clientId || !clientSecret) {
    return Response.redirect('https://podlens.app/settings.html?youtube=error&msg=config', 302);
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      return Response.redirect('https://podlens.app/settings.html?youtube=error&msg=token_exchange', 302);
    }

    const tokens = await tokenRes.json();
    const { access_token, refresh_token, expires_in } = tokens;
    const expiresAt = new Date(Date.now() + (expires_in || 3600) * 1000).toISOString();

    // Get Google user info
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${access_token}` },
    });
    const profile = profileRes.ok ? await profileRes.json() : {};
    const googleId = profile.id || '';
    const displayName = profile.name || '';

    const userId = state || null;

    // Store in Supabase
    if (userId) {
      await sbUpsert('connected_accounts', {
        user_id: userId,
        provider: 'youtube',
        access_token,
        refresh_token: refresh_token || null,
        expires_at: expiresAt,
        provider_user_id: googleId,
        provider_username: displayName,
        updated_at: new Date().toISOString(),
      }, 'user_id,provider');

      trackEvent(userId, 'youtube_connected', { display_name: displayName });

      // Import YouTube subscriptions (fire-and-forget — can take a while)
      importYouTubeSubscriptions(access_token, userId).catch(() => {});
    }

    // Cache in Blobs
    if (userId) {
      try {
        const store = getStore('podlens-users');
        await store.setJSON(`youtube-${userId}`, {
          accessToken: access_token,
          refreshToken: refresh_token || null,
          expiresAt,
          googleId,
          displayName,
          connectedAt: new Date().toISOString(),
        });
      } catch { /* non-critical */ }
    }

    const params = new URLSearchParams({ youtube: 'connected', display_name: displayName });
    return Response.redirect(`https://podlens.app/settings.html?${params}`, 302);

  } catch (e: any) {
    console.error('YouTube callback error:', e);
    return Response.redirect('https://podlens.app/settings.html?youtube=error&msg=server', 302);
  }
};

async function importYouTubeSubscriptions(accessToken: string, userId: string) {
  try {
    let pageToken = '';
    let imported = 0;
    const maxPages = 5; // Max 250 subscriptions

    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({
        part: 'snippet',
        mine: 'true',
        maxResults: '50',
        ...(pageToken ? { pageToken } : {}),
      });

      const res = await fetch(`https://www.googleapis.com/youtube/v3/subscriptions?${params}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) break;
      const data = await res.json();

      for (const item of (data.items || [])) {
        const ch = item.snippet?.resourceId?.channelId;
        const title = item.snippet?.title || '';
        const art = item.snippet?.thumbnails?.default?.url || '';
        if (!ch) continue;

        const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${ch}`;
        await sbUpsert('followed_shows', {
          user_id: userId,
          show_slug: ch,
          show_name: title,
          artwork_url: art,
          feed_url: feedUrl,
          platform: 'youtube',
          created_at: new Date().toISOString(),
        }, 'user_id,feed_url');
        imported++;
      }

      pageToken = data.nextPageToken || '';
      if (!pageToken) break;
    }
  } catch { /* non-critical */ }
}

export const config: Config = { path: '/auth/youtube/callback' };
