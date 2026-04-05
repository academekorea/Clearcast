import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

async function fetchYouTubeChannelData(channelId: string): Promise<{
  subscriberCount?: string; videoCount?: string; viewCount?: string;
  channelBanner?: string; channelDescription?: string; thumbnailHigh?: string;
  recentVideos?: Array<{ videoId: string; title: string; thumbnail: string; publishedAt: string; viewCount?: string }>;
} | null> {
  const apiKey = Netlify.env.get("YOUTUBE_API_KEY");
  if (!apiKey) return null;
  try {
    const chanRes = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,brandingSettings&id=${channelId}&key=${apiKey}`
    );
    const chanJson = await chanRes.json() as any;
    const item = chanJson.items?.[0];
    if (!item) return null;
    const stats = item.statistics || {};
    const branding = item.brandingSettings?.image || {};
    const snippet = item.snippet || {};
    const thumbnailHigh = snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || "";

    // Fetch recent 12 videos
    const searchRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&maxResults=12&order=date&type=video&key=${apiKey}`
    );
    const searchJson = await searchRes.json() as any;
    const videoIds = (searchJson.items || []).map((v: any) => v.id?.videoId).filter(Boolean);
    let recentVideos: Array<{ videoId: string; title: string; thumbnail: string; publishedAt: string; viewCount?: string }> = [];
    if (videoIds.length) {
      const vidRes = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoIds.join(",")}&key=${apiKey}`
      );
      const vidJson = await vidRes.json() as any;
      recentVideos = (vidJson.items || []).map((v: any) => ({
        videoId: v.id,
        title: v.snippet?.title || "",
        thumbnail: v.snippet?.thumbnails?.medium?.url || "",
        publishedAt: v.snippet?.publishedAt || "",
        viewCount: v.statistics?.viewCount,
      }));
    }
    return {
      subscriberCount: stats.subscriberCount,
      videoCount: stats.videoCount,
      viewCount: stats.viewCount,
      channelBanner: branding.bannerExternalUrl || branding.bannerImageUrl || null,
      channelDescription: snippet.description || null,
      thumbnailHigh,
      recentVideos,
    };
  } catch { return null; }
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const slug = url.searchParams.get("id") || url.searchParams.get("slug") || "";

  if (!slug) {
    return new Response(JSON.stringify({ error: "Show ID required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const showStore = getStore("podlens-shows");
    const jobStore = getStore("podlens-jobs");

    const show = await showStore.get(slug, { type: "json" }).catch(() => null) as any;
    if (!show) {
      return new Response(JSON.stringify({ show: null, episodes: [], metrics: {} }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    const ids: string[] = (show.episodeIds || []).slice(0, 50);
    const epData = await Promise.all(
      ids.map((id: string) => jobStore.get(id, { type: "json" }).catch(() => null))
    );
    const completed = epData.filter((e: any) => e && e.status === "complete") as any[];

    // ── Bias scores ──
    const scores = completed.map((e: any) => e.biasScore).filter((s: any) => typeof s === "number");
    const avgBiasScore = scores.length
      ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length)
      : null;
    const biasLabel = avgBiasScore === null ? null
      : avgBiasScore <= -60 ? "Far left"
      : avgBiasScore <= -20 ? "Lean left"
      : avgBiasScore < 20 ? "Center"
      : avgBiasScore < 60 ? "Lean right" : "Far right";

    // ── Host trust ──
    const trustScores = completed.map((e: any) => e.hostTrustScore).filter((s: any) => typeof s === "number");
    const avgTrustScore = trustScores.length
      ? Math.round(trustScores.reduce((a: number, b: number) => a + b, 0) / trustScores.length)
      : null;

    // ── Audio lean ──
    const leans = completed.filter((e: any) => e.audioLean && typeof e.audioLean.leftPct === "number");
    const avgAudioLean = leans.length ? {
      leftPct: Math.round(leans.reduce((s: number, e: any) => s + e.audioLean.leftPct, 0) / leans.length),
      centerPct: Math.round(leans.reduce((s: number, e: any) => s + e.audioLean.centerPct, 0) / leans.length),
      rightPct: Math.round(leans.reduce((s: number, e: any) => s + e.audioLean.rightPct, 0) / leans.length),
    } : null;

    // ── Consistency score (lower variance = more consistent) ──
    let consistencyScore: number | null = null;
    if (scores.length >= 2 && avgBiasScore !== null) {
      const variance = scores.reduce((a: number, s: number) => a + Math.pow(s - avgBiasScore, 2), 0) / scores.length;
      consistencyScore = Math.max(0, Math.min(100, Math.round(100 - Math.sqrt(variance) * 1.5)));
    }

    // ── Factuality ──
    const fc = { factual: 0, mixed: 0, unreliable: 0 };
    for (const ep of completed) {
      const fl = (ep.factualityLabel || "").toLowerCase();
      if (fl.includes("factual") && !fl.includes("mixed")) fc.factual++;
      else if (fl.includes("mixed")) fc.mixed++;
      else if (fl.includes("unreliable")) fc.unreliable++;
    }
    const factTotal = fc.factual + fc.mixed + fc.unreliable;
    const factualPct = factTotal > 0 ? Math.round((fc.factual / factTotal) * 100) : null;

    // ── Sponsor influence rate ──
    const withSponsors = completed.filter((e: any) => e.sponsorConflicts && e.sponsorConflicts.length > 0).length;
    const sponsorRate = completed.length > 0 ? Math.round((withSponsors / completed.length) * 100) : null;

    // ── Topic frequency map ──
    const topicCounts: Record<string, { count: number; leftTotal: number; centerTotal: number; rightTotal: number }> = {};
    for (const ep of completed) {
      for (const t of (ep.topicBreakdown || [])) {
        if (!t.topic) continue;
        if (!topicCounts[t.topic]) topicCounts[t.topic] = { count: 0, leftTotal: 0, centerTotal: 0, rightTotal: 0 };
        topicCounts[t.topic].count++;
        if (t.lean === "left") topicCounts[t.topic].leftTotal++;
        else if (t.lean === "right") topicCounts[t.topic].rightTotal++;
        else topicCounts[t.topic].centerTotal++;
      }
    }
    const topicMap = Object.entries(topicCounts)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8)
      .map(([topic, d]) => ({
        topic,
        count: d.count,
        lean: d.leftTotal > d.rightTotal && d.leftTotal > d.centerTotal ? "left"
          : d.rightTotal > d.leftTotal && d.rightTotal > d.centerTotal ? "right" : "center",
      }));

    // ── Bias drift data (for chart) ──
    const driftData = completed
      .filter((e: any) => e.createdAt && typeof e.biasScore === "number")
      .sort((a: any, b: any) => a.createdAt - b.createdAt)
      .map((e: any) => ({
        createdAt: e.createdAt,
        biasScore: e.biasScore,
        episodeTitle: e.episodeTitle || "",
      }));

    // Detect YouTube channel and fetch channel data
    let youtubeChannel: any = null;
    const feedUrl: string = show.feedUrl || "";
    const ytChannelMatch = feedUrl.match(/youtube\.com\/feeds\/videos\.xml\?channel_id=([^&]+)/);
    if (ytChannelMatch) {
      youtubeChannel = await fetchYouTubeChannelData(ytChannelMatch[1]);
      if (youtubeChannel) youtubeChannel.channelId = ytChannelMatch[1];
    }

    return new Response(JSON.stringify({
      show,
      episodeCount: completed.length,
      youtubeChannel,
      metrics: {
        avgBiasScore, biasLabel, avgTrustScore, avgAudioLean,
        consistencyScore, factualPct, factCounts: fc,
        sponsorRate, topicMap,
      },
      driftData,
      episodes: completed
        .sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0))
        .map((e: any) => ({
          jobId: e.jobId,
          episodeTitle: e.episodeTitle,
          duration: e.duration,
          biasScore: e.biasScore,
          biasLabel: e.biasLabel,
          factualityLabel: e.factualityLabel,
          audioLean: e.audioLean || null,
          createdAt: e.createdAt,
        })),
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/show-profile" };
