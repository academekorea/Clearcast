import type { Config } from "@netlify/functions";

/**
 * resolve-redirect — follow all HTTP redirects and return the final audio URL.
 *
 * Podcast tracking wrappers (pdst.fm, podtrac, megaphone redirect chains,
 * Chartable, etc.) return HTTP 301/302 chains before reaching the actual .mp3.
 * AssemblyAI can't follow these and receives HTML instead of audio, causing
 * "Transcoding failed. File does not appear to contain audio."
 *
 * This endpoint resolves the chain server-side using a HEAD request with
 * redirect:follow, then returns the final destination URL.
 * Falls back to the original URL on any error so analysis is never blocked.
 */

function isYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com\/(?:watch|shorts|embed|v\/)|youtu\.be\/|m\.youtube\.com\/watch)/.test(url);
}

async function resolveUrl(url: string): Promise<string> {
  // YouTube URLs need audio extraction via Railway/yt-dlp — AssemblyAI cannot
  // download audio from youtube.com watch pages directly.
  if (isYouTubeUrl(url)) {
    const audioServiceUrl = Netlify.env.get("AUDIO_SERVICE_URL");
    if (audioServiceUrl) {
      return `${audioServiceUrl}/audio?url=${encodeURIComponent(url)}`;
    }
    return url; // graceful fallback if service not configured
  }

  // Attempt 1: lightweight HEAD request — most servers support this
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
    // response.url is the final URL after all redirects per Fetch spec
    if (res.url && res.url !== url) return res.url;
    if (res.url) return res.url;
  } catch { /* HEAD failed — try partial GET */ }

  // Attempt 2: partial GET (Range: bytes=0-0) for servers that reject HEAD
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
    return res.url || url;
  } catch { /* both methods failed */ }

  return url; // Return original — never block analysis
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
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const resolved = await resolveUrl(url);
    return new Response(
      JSON.stringify({ resolved, original: url, changed: resolved !== url }),
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
