// Standalone module: resolveYouTubeConnection
// Reads a user's YouTube-connected shows from Supabase followed_shows.
// Clean inputs/outputs — not coupled to Netlify function format.

import { getSupabaseAdmin } from './supabase.js'

export interface YouTubeShow {
  id: string
  channelId: string
  name: string
  artwork: string
  feedUrl: string
  platform: 'youtube'
}

export interface YouTubeConnectionResult {
  connected: boolean
  shows: YouTubeShow[]
  displayName: string
  error?: 'db_unavailable'
}

export async function resolveYouTubeConnection(userId: string): Promise<YouTubeConnectionResult> {
  const sb = getSupabaseAdmin()
  if (!sb) return { connected: false, shows: [], displayName: '', error: 'db_unavailable' }

  // Check whether this user has a YouTube account linked
  const { data: account } = await sb
    .from('connected_accounts')
    .select('provider_username')
    .eq('user_id', userId)
    .eq('provider', 'youtube')
    .maybeSingle()

  if (!account) return { connected: false, shows: [], displayName: '' }

  // Fetch their imported YouTube subscriptions
  const { data: rows } = await sb
    .from('followed_shows')
    .select('show_slug, show_name, show_artwork, artwork_url, feed_url')
    .eq('user_id', userId)
    .eq('platform', 'youtube')
    .order('created_at', { ascending: false })
    .limit(100)

  // Filter out channels with no meaningful content and deduplicate by show_slug
  const seen = new Set<string>()
  const shows: YouTubeShow[] = []

  for (const r of rows || []) {
    if (!r.show_name || seen.has(r.show_slug)) continue
    seen.add(r.show_slug)
    shows.push({
      id: r.show_slug,
      channelId: r.show_slug,
      name: r.show_name,
      artwork: r.show_artwork || r.artwork_url || '',
      feedUrl:
        r.feed_url ||
        `https://www.youtube.com/feeds/videos.xml?channel_id=${r.show_slug}`,
      platform: 'youtube',
    })
  }

  return { connected: true, shows, displayName: account.provider_username || '' }
}
