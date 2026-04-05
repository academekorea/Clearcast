import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// ── URL PARSERS ───────────────────────────────────────────────────────────────

function extractVideoId(url: string): string | null {
  const patterns = [
    /[?&]v=([^&#]+)/,
    /youtu\.be\/([^?&#/]+)/,
    /youtube\.com\/embed\/([^?&#/]+)/,
    /youtube\.com\/shorts\/([^?&#/]+)/,
    /youtube\.com\/v\/([^?&#/]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

function extractHandle(url: string): string | null {
  const m = url.match(/youtube\.com\/@([^/?&#]+)/);
  return m?.[1] ?? null;
}

function extractChannelId(url: string): string | null {
  const m = url.match(/youtube\.com\/channel\/([^/?&#]+)/);
  return m?.[1] ?? null;
}

// ── RSS DISCOVERY ─────────────────────────────────────────────────────────────

const RSS_INDICATORS = [
  'anchor.fm', 'buzzsprout', 'podbean', 'transistor.fm',
  'simplecast', 'libsyn', 'rss.com', 'megaphone.fm',
  'podcastone', 'acast', 'spreaker', 'redcircle',
  '/feed', '/rss', '.xml', 'feeds.', 'feed2',
];

function findRssInText(text: string): string | null {
  const urlPattern = /https?:\/\/[^\s"'<>)\]]+/g;
  const matches = text.match(urlPattern) ?? [];
  for (const u of matches) {
    const clean = u.replace(/[)>\]'",.]+$/, '');
    if (RSS_INDICATORS.some(d => clean.toLowerCase().includes(d))) return clean;
  }
  return null;
}

async function findItunesFeed(channelTitle: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(channelTitle)}&media=podcast&limit=3`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const results: any[] = data.results ?? [];
    const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    const target = clean(channelTitle);
    for (const r of results) {
      if (!r.feedUrl) continue;
      const name = clean(r.collectionName ?? r.trackName ?? "");
      const targetWords = target.split(" ").filter(Boolean);
      const overlap = targetWords.filter(w => name.includes(w)).length;
      if (overlap / targetWords.length >= 0.5) return r.feedUrl;
    }
    // Fallback: just return first result if it has a feed
    return results.find(r => r.feedUrl)?.feedUrl ?? null;
  } catch {
    return null;
  }
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = Netlify.env.get("YOUTUBE_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "YouTube API not configured" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  let body: any = {};
  try { body = await req.json(); } catch {}
  const inputUrl: string = (body.url ?? "").trim();
  if (!inputUrl) {
    return new Response(JSON.stringify({ error: "url required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  // ── STEP 1: Parse URL type ──────────────────────────────────────────────────
  const videoId = extractVideoId(inputUrl);
  const handle = extractHandle(inputUrl);
  const channelIdFromUrl = extractChannelId(inputUrl);

  // Check Blobs cache (24h TTL)
  const store = getStore("podlens-youtube-feeds");
  const cacheKey = videoId
    ? `video-${videoId}`
    : handle
    ? `handle-${handle}`
    : channelIdFromUrl
    ? `channel-${channelIdFromUrl}`
    : null;

  if (cacheKey) {
    try {
      const cached = await store.get(cacheKey, { type: "json" }) as any;
      if (cached?.resolvedAt && Date.now() - new Date(cached.resolvedAt).getTime() < 86_400_000) {
        return new Response(JSON.stringify(cached), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
    } catch {}
  }

  // ── STEP 2: Get channel info via YouTube Data API ───────────────────────────
  let channelId: string | null = channelIdFromUrl;
  let channelTitle = "";
  let description = "";
  let thumbnail = "";

  if (videoId) {
    try {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=snippet&key=${apiKey}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (res.ok) {
        const d = await res.json();
        const snippet = d.items?.[0]?.snippet;
        if (snippet) {
          channelId = snippet.channelId ?? null;
          channelTitle = snippet.channelTitle ?? "";
          description = snippet.description ?? "";
          thumbnail = snippet.thumbnails?.high?.url ?? snippet.thumbnails?.default?.url ?? "";
        }
      }
    } catch {}
  } else if (handle || channelIdFromUrl) {
    const param = handle
      ? `forHandle=${encodeURIComponent("@" + handle)}`
      : `id=${channelIdFromUrl}`;
    try {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?${param}&part=snippet&key=${apiKey}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (res.ok) {
        const d = await res.json();
        const item = d.items?.[0];
        if (item) {
          channelId = item.id ?? null;
          channelTitle = item.snippet?.title ?? "";
          description = item.snippet?.description ?? "";
          thumbnail = item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.default?.url ?? "";
        }
      }
    } catch {}
  }

  // ── STEP 3: Find RSS feed (A → B → C, never fail) ──────────────────────────
  let feedUrl: string | null = null;
  let feedType = "youtube-rss";

  // A: Scan description for podcast RSS links
  if (description) {
    const found = findRssInText(description);
    if (found) { feedUrl = found; feedType = "podcast-rss"; }
  }

  // B: iTunes lookup by channel name
  if (!feedUrl && channelTitle) {
    const found = await findItunesFeed(channelTitle);
    if (found) { feedUrl = found; feedType = "podcast-rss"; }
  }

  // C: YouTube channel RSS (ALWAYS exists)
  if (!feedUrl && channelId) {
    feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    feedType = "youtube-rss";
  }

  // D: Direct video URL (last resort for single videos without channel)
  if (!feedUrl && videoId) {
    feedUrl = `https://www.youtube.com/watch?v=${videoId}`;
    feedType = "direct";
  }

  if (!feedUrl) {
    feedUrl = inputUrl;
    feedType = "direct";
  }

  const result = {
    channelId,
    channelTitle,
    feedUrl,
    feedType,
    videoId: videoId ?? null,
    thumbnail,
    resolvedAt: new Date().toISOString(),
    method: feedType,
  };

  // ── STEP 4: Cache result ────────────────────────────────────────────────────
  if (cacheKey) {
    try { await store.setJSON(cacheKey, result); } catch {}
  }
  if (channelId && cacheKey !== `channel-${channelId}`) {
    try { await store.setJSON(`channel-${channelId}`, result); } catch {}
  }

  return new Response(JSON.stringify(result), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = { path: "/api/resolve-youtube" };
