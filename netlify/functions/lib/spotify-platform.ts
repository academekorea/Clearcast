// Standalone module: resolveSpotifyConnection
// Fetches a user's followed Spotify shows, looks up RSS feeds, upserts to Supabase.
// Clean inputs/outputs — not coupled to Netlify function format.

import { getSupabaseAdmin } from './supabase.js'

export interface SpotifyShow {
  id: string
  name: string
  publisher: string
  artwork: string
  spotifyUrl: string
  feedUrl: string | null
  totalEpisodes: number
  needsRss: boolean
  platform: 'spotify'
}

export interface SpotifyConnectionResult {
  connected: boolean
  shows: SpotifyShow[]
  displayName: string
  error?: 'auth_expired' | 'not_configured' | 'fetch_failed' | 'db_unavailable'
}

async function refreshSpotifyToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<string | null> {
  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + btoa(`${clientId}:${clientSecret}`),
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.access_token || null
  } catch {
    return null
  }
}

async function lookupRssByName(showName: string): Promise<string | null> {
  try {
    const q = encodeURIComponent(showName.slice(0, 60))
    const res = await fetch(
      `https://itunes.apple.com/search?term=${q}&entity=podcast&limit=5`,
      { signal: AbortSignal.timeout(5000) },
    )
    if (!res.ok) return null
    const data = await res.json()
    const results: any[] = data.results || []
    if (!results.length) return null
    const nameLower = showName.toLowerCase()
    const match =
      results.find(
        (r) =>
          r.feedUrl &&
          r.collectionName?.toLowerCase().startsWith(nameLower.slice(0, 12)),
      ) || results.find((r) => r.feedUrl)
    return match?.feedUrl || null
  } catch {
    return null
  }
}

export async function resolveSpotifyConnection(userId: string): Promise<SpotifyConnectionResult> {
  const sb = getSupabaseAdmin()
  if (!sb) return { connected: false, shows: [], displayName: '', error: 'db_unavailable' }

  const clientId = Netlify.env.get('SPOTIFY_CLIENT_ID')
  const clientSecret = Netlify.env.get('SPOTIFY_CLIENT_SECRET')
  if (!clientId || !clientSecret)
    return { connected: false, shows: [], displayName: '', error: 'not_configured' }

  // Retrieve stored token from connected_accounts
  const { data: account } = await sb
    .from('connected_accounts')
    .select('access_token, refresh_token, expires_at, provider_username')
    .eq('user_id', userId)
    .eq('provider', 'spotify')
    .maybeSingle()

  if (!account) return { connected: false, shows: [], displayName: '' }

  let accessToken: string = account.access_token
  const expiresAt = new Date(account.expires_at || 0)

  // Refresh token if expired or expiring within 5 minutes
  if (expiresAt.getTime() < Date.now() + 5 * 60 * 1000) {
    if (!account.refresh_token)
      return { connected: false, shows: [], displayName: '', error: 'auth_expired' }
    const newToken = await refreshSpotifyToken(account.refresh_token, clientId, clientSecret)
    if (!newToken)
      return { connected: false, shows: [], displayName: '', error: 'auth_expired' }
    await sb
      .from('connected_accounts')
      .update({
        access_token: newToken,
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('provider', 'spotify')
    accessToken = newToken
  }

  // Fetch followed podcast shows from Spotify (up to 150)
  const spotifyShows: any[] = []
  try {
    let nextUrl: string | null = 'https://api.spotify.com/v1/me/shows?limit=50'
    for (let page = 0; page < 3 && nextUrl; page++) {
      const res = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) break
      const data = await res.json()
      spotifyShows.push(...(data.items || []).map((i: any) => i.show).filter(Boolean))
      nextUrl = data.next || null
    }
  } catch {
    return { connected: true, shows: [], displayName: account.provider_username || '', error: 'fetch_failed' }
  }

  // Get RSS feeds we've already cached in followed_shows
  const { data: existing } = await sb
    .from('followed_shows')
    .select('show_slug, feed_url')
    .eq('user_id', userId)
    .eq('platform', 'spotify')

  const cachedFeeds = new Map<string, string | null>(
    (existing || []).map((r: any) => [r.show_slug, r.feed_url || null]),
  )
  const existingSlugs = new Set(cachedFeeds.keys())

  // For each show: resolve RSS, collect rows to insert
  const shows: SpotifyShow[] = []
  const toInsert: any[] = []

  for (const show of spotifyShows) {
    if (!show?.id) continue
    let feedUrl: string | null = null

    if (cachedFeeds.has(show.id)) {
      feedUrl = cachedFeeds.get(show.id) ?? null
    } else {
      feedUrl = await lookupRssByName(show.name || '')
    }

    shows.push({
      id: show.id,
      name: show.name || '',
      publisher: show.publisher || '',
      artwork: show.images?.[0]?.url || '',
      spotifyUrl: show.external_urls?.spotify || '',
      feedUrl,
      totalEpisodes: show.total_episodes || 0,
      needsRss: !feedUrl,
      platform: 'spotify',
    })

    // Only insert shows not already in the DB
    if (!existingSlugs.has(show.id)) {
      toInsert.push({
        user_id: userId,
        show_slug: show.id,
        show_name: show.name || '',
        show_artwork: show.images?.[0]?.url || '',
        artwork_url: show.images?.[0]?.url || '',
        feed_url: feedUrl || null,
        platform: 'spotify',
        source: 'spotify',
        created_at: new Date().toISOString(),
      })
    }
  }

  // Insert new shows (fire and forget)
  if (toInsert.length) {
    sb.from('followed_shows').insert(toInsert).then(() => {}).catch(() => {})
  }

  return { connected: true, shows, displayName: account.provider_username || '' }
}
