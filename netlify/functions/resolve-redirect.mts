import type { Config } from "@netlify/functions";

/**
 * resolve-redirect — resolve any podcast/audio URL to a direct audio file URL.
 *
 * Handles three cases:
 *   1. RSS feed URLs   → parse feed, extract latest episode enclosure URL
 *   2. YouTube URLs    → return unchanged (transcribe-background owns this)
 *   3. Everything else → follow HTTP redirect chain (pdst.fm, podtrac, Chartable, etc.)
 *
 * Always returns the original URL on error so analysis is never blocked.
 */

function isYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com\/(?:watch|shorts|embed|v\/)|youtu\.be\/|m\.youtube\.com\/watch)/.test(url);
}

// Podcast analytics redirect chains and direct audio files — never attempt RSS parsing on these
function isDirectAudioUrl(url: string): boolean {
  // Known podcast analytics/redirect CDN patterns
  if (/dts\.podtrac\.com\/redirect\./i.test(url)) return true;
  if (/podtrac\.com\/redirect\//i.test(url)) return true;
  if (/pdst\.fm\/e\//i.test(url)) return true;
  if (/pfx\.vpixl\.com/i.test(url)) return true;
  if (/chtbl\.com\/track\//i.test(url)) return true;
  if (/chrt\.fm\/track\//i.test(url)) return true;
  if (/op3\.dev\/e\//i.test(url)) return true;
  if (/mgln\.ai\/e\//i.test(url)) return true;
  if (/arttrk\.com\/p\//i.test(url)) return true;
  if (/prfx\.byspotify\.com\/e\//i.test(url)) return true;
  // Direct audio file extensions (before any query string)
  const path = url.split("?")[0];
  if (/\.(mp3|m4a|ogg|wav|aac)$/i.test(path)) return true;
  return false;
}

function isFeedUrl(url: string): boolean {
  return /(?:feeds?\.|\/rss|\/feed|\.xml|rss\.|anchor\.fm\/s\/.+\/podcast\/rss)/i.test(url);
}

function extractCdata(raw: string): string {
  const m = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/s);
  return m ? m[1].trim() : raw.trim();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

interface FeedResult {
  enclosureUrl: string;
  episodeTitle: string;
  showName: string;
  artwork: string;
}

async function resolveRssFeed(feedUrl: string): Promise<FeedResult | null> {
  const res = await fetch(feedUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; PodcastIndexBot/1.0)",
      "Accept": "application/rss+xml, application/xml, text/xml, */*",
    },
    signal: AbortSignal.timeout(12000),
    redirect: "follow",
  });
  if (!res.ok) return null;

  const xml = await res.text();
  if (!xml.includes("<rss") && !xml.includes("<feed")) return null;

  // Channel-level show name and artwork
  const showNameRaw = xml.match(/<channel>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const showName = stripTags(extractCdata(showNameRaw));
  const channelArtwork =
    xml.match(/<itunes:image[^>]+href=["']([^"']+)["']/i)?.[1] ||
    xml.match(/<image>[\s\S]*?<url[^>]*>([\s\S]*?)<\/url>/i)?.[1]?.trim() ||
    "";

  // Split into <item> chunks — slice(1) drops the channel header before first item
  const itemChunks = xml.split(/<item[\s>]/i).slice(1);
  if (!itemChunks.length) return null;

  for (const chunk of itemChunks) {
    // Match enclosure — try audio type first, then mp3 extension, then any enclosure
    const enclosureMatch =
      chunk.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']audio[^"']*["'][^>]*/i) ||
      chunk.match(/<enclosure[^>]+type=["']audio[^"']*["'][^>]*url=["']([^"']+)["'][^>]*/i) ||
      chunk.match(/<enclosure[^>]+url=["']([^"']+\.mp3[^"']*?)["']/i) ||
      chunk.match(/<enclosure[^>]+url=["']([^"']+)["']/i);

    if (!enclosureMatch?.[1]) continue;
    const enclosureUrl = enclosureMatch[1];

    const episodeTitleRaw = chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
    const episodeTitle = stripTags(extractCdata(episodeTitleRaw));

    const epArtwork =
      chunk.match(/<itunes:image[^>]+href=["']([^"']+)["']/i)?.[1] ||
      channelArtwork;

    return { enclosureUrl, episodeTitle, showName, artwork: epArtwork };
  }

  return null; // No enclosure found in any item
}

interface ResolveResult {
  resolved: string;
  episodeTitle?: string;
  showName?: string;
  artwork?: string;
  selectedFromFeed?: boolean;
}

async function resolveUrl(url: string): Promise<ResolveResult> {
  // YouTube: handled entirely by transcribe-background via POST /extract
  if (isYouTubeUrl(url)) return { resolved: url };

  // Direct audio or known analytics redirect chain — skip RSS parsing entirely
  if (isDirectAudioUrl(url)) {
    // Still follow the HTTP redirect chain to get the final CDN URL
    try {
      const res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; PodcastIndexBot/1.0)",
          "Accept": "audio/mpeg, audio/*, */*",
        },
      });
      return { resolved: res.url || url };
    } catch { /* HEAD failed — return original */ }
    return { resolved: url };
  }

  // RSS feed: parse and extract the latest episode enclosure URL
  if (isFeedUrl(url)) {
    try {
      const feed = await resolveRssFeed(url);
      if (feed?.enclosureUrl) {
        return {
          resolved: feed.enclosureUrl,
          episodeTitle: feed.episodeTitle || undefined,
          showName: feed.showName || undefined,
          artwork: feed.artwork || undefined,
          selectedFromFeed: true,
        };
      }
    } catch { /* fall through to original URL */ }
    return { resolved: url };
  }

  // Podcast tracking redirect chains (pdst.fm, podtrac, Chartable, megaphone, etc.)
  // Attempt 1: lightweight HEAD request
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PodcastIndexBot/1.0)",
        "Accept": "audio/mpeg, audio/*, */*",
      },
    });
    if (res.url && res.url !== url) return { resolved: res.url };
    if (res.url) return { resolved: res.url };
  } catch { /* HEAD failed — try partial GET */ }

  // Attempt 2: partial GET for servers that reject HEAD
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PodcastIndexBot/1.0)",
        "Accept": "audio/mpeg, audio/*, */*",
        "Range": "bytes=0-0",
      },
    });
    return { resolved: res.url || url };
  } catch { /* both methods failed */ }

  return { resolved: url };
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let url: string;
  try {
    ({ url } = await req.json());
    if (!url || typeof url !== "string") throw new Error("url required");
  } catch (e: any) {
    console.error("[resolve-redirect]", e?.message || e);
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const result = await resolveUrl(url);
    return new Response(
      JSON.stringify({ ...result, original: url, changed: result.resolved !== url }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    // Defensive catch — always return original URL, never block analysis
    return new Response(
      JSON.stringify({ resolved: url, original: url, changed: false }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config: Config = { path: "/api/resolve-redirect" };
