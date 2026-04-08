import type { Config } from "@netlify/functions";
import { resolveSpotifyConnection } from './lib/spotify-platform.js';
import { resolveYouTubeConnection } from './lib/youtube-platform.js';

// GET /api/my-shows?userId=<userId>
// Thin wrapper — delegates to standalone platform modules.
// Returns { spotify: SpotifyConnectionResult, youtube: YouTubeConnectionResult }

export default async (req: Request) => {
  const json = (data: object, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  const url = new URL(req.url);
  const userId = url.searchParams.get('userId');
  if (!userId) return json({ error: 'Missing userId' }, 400);

  const [spotifyResult, youtubeResult] = await Promise.allSettled([
    resolveSpotifyConnection(userId),
    resolveYouTubeConnection(userId),
  ]);

  return json({
    spotify:
      spotifyResult.status === 'fulfilled'
        ? spotifyResult.value
        : { connected: false, shows: [], displayName: '' },
    youtube:
      youtubeResult.status === 'fulfilled'
        ? youtubeResult.value
        : { connected: false, shows: [], displayName: '' },
  });
};

export const config: Config = { path: '/api/my-shows' };
