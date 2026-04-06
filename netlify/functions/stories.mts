import type { Config } from "@netlify/functions";

function parseIsoDuration(iso: string): string {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return "";
  const h = parseInt(match[1] || "0");
  const m = parseInt(match[2] || "0");
  const s = parseInt(match[3] || "0");
  const totalMin = h * 60 + m + Math.round(s / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const query = url.searchParams.get("q") || "news";
  const region = url.searchParams.get("region") || "us";
  const lang = url.searchParams.get("lang") || "";

  // Derive country code and language from region param
  const isKorean = region === "ko-KR" || region === "kr";
  const regionCode = isKorean ? "KR" : (region !== "international" && region.length === 2 ? region.toUpperCase() : "US");
  const langCode = lang || (isKorean ? "ko" : "en");

  const apiKey = Netlify.env.get("YOUTUBE_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "YouTube API not configured", results: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    // Search YouTube for podcast-length videos (20+ min = "long")
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.set("part", "snippet");
    searchUrl.searchParams.set("type", "video");
    searchUrl.searchParams.set("q", query + " podcast");
    searchUrl.searchParams.set("maxResults", "20");
    searchUrl.searchParams.set("order", "date");
    searchUrl.searchParams.set("videoDuration", "long");
    searchUrl.searchParams.set("regionCode", regionCode);
    searchUrl.searchParams.set("relevanceLanguage", langCode);
    searchUrl.searchParams.set("key", apiKey);

    const searchRes = await fetch(searchUrl.toString());
    if (!searchRes.ok) {
      const errBody = await searchRes.text();
      throw new Error(`YouTube search failed: ${searchRes.status} — ${errBody}`);
    }
    const searchData = await searchRes.json();
    const items: any[] = searchData.items || [];

    // Batch-fetch video durations in one call
    const videoIds = items
      .map((it: any) => it.id?.videoId)
      .filter(Boolean)
      .join(",");

    const durations: Record<string, string> = {};
    if (videoIds) {
      const detailUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
      detailUrl.searchParams.set("part", "contentDetails");
      detailUrl.searchParams.set("id", videoIds);
      detailUrl.searchParams.set("key", apiKey);
      const detailRes = await fetch(detailUrl.toString());
      if (detailRes.ok) {
        const detailData = await detailRes.json();
        for (const v of detailData.items || []) {
          durations[v.id] = parseIsoDuration(v.contentDetails?.duration || "");
        }
      }
    }

    const results = items.map((it: any) => {
      const snippet = it.snippet || {};
      const videoId = it.id?.videoId || "";
      const releaseDate = snippet.publishedAt
        ? new Date(snippet.publishedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "";
      const spotifyUrl = snippet.title
        ? "https://open.spotify.com/search/" +
          encodeURIComponent(snippet.title) +
          "/episodes"
        : "";

      return {
        showName: snippet.channelTitle || "Unknown channel",
        epTitle: snippet.title || "Untitled",
        artwork:
          snippet.thumbnails?.maxres?.url ||
          snippet.thumbnails?.high?.url ||
          snippet.thumbnails?.medium?.url ||
          snippet.thumbnails?.default?.url ||
          "",
        releaseDate,
        duration: durations[videoId] || "",
        youtubeUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "",
        spotifyUrl,
        appleUrl: "",
        feedUrl: "",
        description: snippet.description || "",
      };
    });

    // Deduplicate: max 2 results per channel for variety
    const channelCounts: Record<string, number> = {};
    const deduped = results.filter((r) => {
      channelCounts[r.showName] = (channelCounts[r.showName] || 0) + 1;
      return channelCounts[r.showName] <= 2;
    });

    return new Response(JSON.stringify({ results: deduped, query }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[stories] error:", msg);
    return new Response(
      JSON.stringify({ error: msg, results: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config: Config = { path: "/api/stories" };
