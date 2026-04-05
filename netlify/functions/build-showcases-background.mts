import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Background function — 15 minute timeout for full analysis pipeline
// Triggered by: POST /api/build-showcases (from admin dashboard or check-new-episodes)
// Netlify background functions MUST have -background suffix in filename

const SHOWCASES = [
  {
    slug: "jre",
    show_name: "The Joe Rogan Experience",
    source_type: "youtube" as const,
    source_url: "https://www.youtube.com/@joerogan",
  },
  {
    slug: "lex-fridman",
    show_name: "Lex Fridman Podcast",
    source_type: "youtube" as const,
    source_url: "https://www.youtube.com/@lexfridman",
  },
  {
    slug: "the-daily",
    show_name: "The Daily",
    source_type: "rss" as const,
    source_url: "https://feeds.simplecast.com/54nAGcIl",
  },
  {
    slug: "fresh-air",
    show_name: "Fresh Air",
    source_type: "rss" as const,
    source_url: "https://feeds.npr.org/381444908/podcast.xml",
  },
];

const SITE_URL = "https://podlens.app";

export default async (req: Request) => {
  const store = getStore("podlens-blobs");

  // Parse optional slug param to refresh a specific show
  let body: any = {};
  try { body = await req.json().catch(() => ({})); } catch {}
  const targetSlug = body.slug || null;

  const results: any[] = [];

  for (const show of SHOWCASES) {
    if (targetSlug && show.slug !== targetSlug) continue;

    try {
      // Check if already fresh (< 24 hours old)
      const existing = await store.get(`showcase-card-${show.slug}`, { type: "json" }) as any;
      if (!targetSlug && existing && existing.analyzed_at && !existing.is_placeholder) {
        const age = Date.now() - new Date(existing.analyzed_at).getTime();
        if (age < 86_400_000) {
          results.push({ slug: show.slug, status: "skipped", reason: "fresh" });
          continue;
        }
      }

      // Step 1: Resolve episode URL
      let episodeUrl: string | null = null;
      let episodeTitle = "";
      let episodeDate = "";
      let showArtwork = "";

      if (show.source_type === "youtube") {
        const ytRes = await resolveYouTube(show.source_url);
        if (ytRes) {
          episodeUrl = ytRes.episodeUrl;
          episodeTitle = ytRes.episodeTitle;
          episodeDate = ytRes.episodeDate;
          showArtwork = ytRes.artwork;
        }
      } else {
        const rssRes = await resolveRSS(show.source_url);
        if (rssRes) {
          episodeUrl = rssRes.episodeUrl;
          episodeTitle = rssRes.episodeTitle;
          episodeDate = rssRes.episodeDate;
          showArtwork = rssRes.artwork;
        }
      }

      if (!episodeUrl) {
        results.push({ slug: show.slug, status: "error", reason: "no episode found" });
        continue;
      }

      // Step 2: Trigger analysis (fire and forget — analysis stores result in Blobs)
      const analyzeRes = await fetch(`${SITE_URL}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: episodeUrl,
          userId: "showcase",
          userPlan: "operator",
          userEmail: "showcase@podlens.app",
          showcase: true,
          showcaseSlug: show.slug,
        }),
        signal: AbortSignal.timeout(600_000), // 10 min max
      });

      if (!analyzeRes.ok) {
        results.push({ slug: show.slug, status: "error", reason: `analyze failed: ${analyzeRes.status}` });
        continue;
      }

      const analyzeData = await analyzeRes.json();
      const jobId = analyzeData.jobId;

      if (!jobId) {
        results.push({ slug: show.slug, status: "error", reason: "no jobId" });
        continue;
      }

      // Step 3: Poll for completion (max 10 min)
      let finalData: any = null;
      const pollStart = Date.now();
      while (Date.now() - pollStart < 600_000) {
        await sleep(15_000);
        try {
          const statusRes = await fetch(`${SITE_URL}/api/status/${jobId}?plan=operator`, {
            signal: AbortSignal.timeout(10_000),
          });
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            if (statusData.status === "complete" || statusData.status === "partial") {
              finalData = statusData;
              break;
            }
            if (statusData.status === "error" || statusData.status === "failed") break;
          }
        } catch {}
      }

      if (!finalData) {
        results.push({ slug: show.slug, status: "error", reason: "analysis timed out" });
        continue;
      }

      // Step 4: Extract showcase card data
      const lean = finalData.audioLean || {};
      const biasScore = 50 + (lean.rightPct || 0) / 2 - (lean.leftPct || 0) / 2;
      const biasDirection =
        Math.abs((lean.leftPct || 0) - (lean.rightPct || 0)) < 20
          ? "balanced"
          : (lean.rightPct || 0) > (lean.leftPct || 0)
          ? "right"
          : "left";

      const card = {
        slug: show.slug,
        show_name: show.show_name,
        episode_title: finalData.episodeTitle || episodeTitle,
        episode_date: episodeDate,
        bias_label: lean.plainEnglishLabel || "Analyzed",
        bias_score: Math.round(biasScore),
        bias_direction: biasDirection,
        top_finding: finalData.keyFindings?.[0]?.finding || finalData.flags?.[0]?.description || "",
        show_artwork: finalData.artworkUrl || showArtwork || "",
        analysis_url: `/analysis/${jobId}`,
        source_type: show.source_type,
        analyzed_at: new Date().toISOString(),
        is_placeholder: false,
      };

      await store.setJSON(`showcase-card-${show.slug}`, card);
      results.push({ slug: show.slug, status: "complete", jobId });

    } catch (e: any) {
      results.push({ slug: show.slug, status: "error", reason: e?.message || "unknown" });
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveYouTube(channelUrl: string) {
  try {
    const apiKey = Netlify.env.get("YOUTUBE_API_KEY") || "";
    if (!apiKey) return null;

    // Get handle from URL
    const handleMatch = channelUrl.match(/@([^/?&#]+)/);
    if (!handleMatch) return null;
    const handle = handleMatch[1];

    // Get channel ID
    const chanRes = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?forHandle=${encodeURIComponent("@" + handle)}&part=snippet&key=${apiKey}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!chanRes.ok) return null;
    const chanData = await chanRes.json();
    const channelId = chanData.items?.[0]?.id;
    const artwork = chanData.items?.[0]?.snippet?.thumbnails?.high?.url || "";
    if (!channelId) return null;

    // Get latest video
    const vidRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?channelId=${channelId}&part=snippet&order=date&maxResults=1&type=video&key=${apiKey}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!vidRes.ok) return null;
    const vidData = await vidRes.json();
    const video = vidData.items?.[0];
    if (!video) return null;

    return {
      episodeUrl: `https://www.youtube.com/watch?v=${video.id.videoId}`,
      episodeTitle: video.snippet?.title || "",
      episodeDate: video.snippet?.publishedAt?.slice(0, 10) || "",
      artwork,
    };
  } catch { return null; }
}

async function resolveRSS(feedUrl: string) {
  try {
    const res = await fetch(feedUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const xml = await res.text();

    // Extract first item
    const itemMatch = xml.match(/<item[^>]*>([\s\S]*?)<\/item>/i);
    if (!itemMatch) return null;
    const item = itemMatch[1];

    const title = (item.match(/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>/i)
      || item.match(/<title[^>]*>(.*?)<\/title>/i))?.[1] || "";
    const enclosure = item.match(/<enclosure[^>]+url="([^"]+)"/i)?.[1]
      || item.match(/<enclosure[^>]+url='([^']+)'/i)?.[1]
      || (item.match(/<link[^>]*>(.*?)<\/link>/i)?.[1]);
    const pubDate = item.match(/<pubDate[^>]*>(.*?)<\/pubDate>/i)?.[1] || "";
    const artwork = xml.match(/<itunes:image[^>]+href="([^"]+)"/i)?.[1]
      || xml.match(/<image[^>]*>[\s\S]*?<url[^>]*>(.*?)<\/url>/i)?.[1]
      || "";

    if (!enclosure) return null;

    return {
      episodeUrl: enclosure.trim(),
      episodeTitle: title.trim(),
      episodeDate: pubDate ? new Date(pubDate).toISOString().slice(0, 10) : "",
      artwork: artwork.trim(),
    };
  } catch { return null; }
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

export const config: Config = { path: "/api/build-showcases" };
