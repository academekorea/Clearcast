import type { Config } from "@netlify/functions";

const TRENDING_TOPICS = [
  "Iran war",
  "Fed interest rates",
  "AI regulation",
  "Gaza ceasefire",
  "Trump tariffs",
  "Climate change",
  "Ukraine Russia",
  "Supreme Court",
  "Immigration",
  "Stock market",
];

const FALLBACK_QUERIES = ["news", "politics", "technology", "business", "society"];

function parseIsoDuration(iso: string): string {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return "";
  const h = parseInt(match[1] || "0");
  const m = parseInt(match[2] || "0");
  const s = parseInt(match[3] || "0");
  const totalMin = h * 60 + m + Math.round(s / 60);
  return totalMin > 0 ? `${totalMin} min` : "";
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const query = url.searchParams.get("q") || "";
  const trending = url.searchParams.get("trending") === "1";

  if (trending) {
    return new Response(JSON.stringify({ topics: TRENDING_TOPICS }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  const apiKey = Netlify.env.get("YOUTUBE_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "YouTube API not configured", results: [] }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  const searchQuery = query || "news";

  try {
    const doSearch = async (term: string) => {
      const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
      searchUrl.searchParams.set("part", "snippet");
      searchUrl.searchParams.set("type", "video");
      searchUrl.searchParams.set("q", term + " podcast");
      searchUrl.searchParams.set("maxResults", "20");
      searchUrl.searchParams.set("order", "date");
      searchUrl.searchParams.set("videoDuration", "long");
      searchUrl.searchParams.set("key", apiKey);

      const res = await fetch(searchUrl.toString());
      if (!res.ok) throw new Error(`YouTube search failed: ${res.status}`);
      const data = await res.json();
      return data.items || [];
    };

    let items = await doSearch(searchQuery);

    if (!items.length && query) {
      items = await doSearch(FALLBACK_QUERIES[0]);
    }

    // Fetch durations in one batch call
    let durations: Record<string, string> = {};
    const videoIds = items.map((it: any) => it.id?.videoId).filter(Boolean);
    if (videoIds.length) {
      const detailUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
      detailUrl.searchParams.set("part", "contentDetails");
      detailUrl.searchParams.set("id", videoIds.join(","));
      detailUrl.searchParams.set("key", apiKey);
      const detailRes = await fetch(detailUrl.toString());
      if (detailRes.ok) {
        const detailData = await detailRes.json();
        for (const v of (detailData.items || [])) {
          const iso = v.contentDetails?.duration || "";
          durations[v.id] = parseIsoDuration(iso);
        }
      }
    }

    const mapped = items.map((it: any) => {
      const snippet = it.snippet || {};
      const videoId = it.id?.videoId || "";
      const showName = snippet.channelTitle || "Unknown channel";
      const epTitle = snippet.title || "Untitled video";
      const artwork =
        snippet.thumbnails?.maxres?.url ||
        snippet.thumbnails?.high?.url ||
        snippet.thumbnails?.medium?.url ||
        snippet.thumbnails?.default?.url ||
        "";
      const releaseDate = snippet.publishedAt
        ? new Date(snippet.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : "";
      const duration = durations[videoId] || "";
      const youtubeUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : "";
      const spotifyUrl = "https://open.spotify.com/search/" + encodeURIComponent(epTitle) + "/episodes";
      return {
        showName, epTitle, artwork, releaseDate, duration,
        appleUrl: "",
        youtubeUrl, spotifyUrl, feedUrl: "",
        description: snippet.description || "",
      };
    });

    return new Response(JSON.stringify({ results: mapped, query: searchQuery }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Search failed", results: [] }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/stories" };
