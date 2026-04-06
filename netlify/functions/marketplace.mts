import type { Config } from "@netlify/functions";

// Correct Apple Podcast RSS genre IDs
const GENRE_IDS: Record<string, string> = {
  "all":         "",
  "news":        "1489",
  "technology":  "1318",
  "business":    "1321",
  "society":     "1324",
  "true-crime":  "1488",
  "crime":       "1488",
  "comedy":      "1303",
  "education":   "1304",
  "health":      "1307",
  "sports":      "1545",
  "history":     "1487",
  "science":     "1533",
  "arts":        "1301",
  "music":       "1310",
  "tv-film":     "1309",
  "religion":    "1314",
  "government":  "1476",
  "fiction":     "1483",
  "kids":        "1535",
};

const SEARCH_TERMS: Record<string, string> = {
  "all":        "top podcast",
  "news":       "news politics podcast",
  "technology": "technology tech podcast",
  "business":   "business entrepreneurship podcast",
  "society":    "society culture podcast",
  "true-crime": "true crime podcast",
  "crime":      "true crime podcast",
  "comedy":     "comedy podcast",
  "education":  "education podcast",
  "health":     "health wellness podcast",
  "sports":     "sports podcast",
  "history":    "history podcast",
  "science":    "science podcast",
};

export default async (req: Request) => {
  const url = new URL(req.url);
  // Support both "genre" (legacy) and "category" param names
  const genre = url.searchParams.get("category") || url.searchParams.get("genre") || "all";
  const region = url.searchParams.get("region") || "international";
  const country = region === "ko-KR" ? "kr" : "us";
  const genreId = GENRE_IDS[genre] ?? GENRE_IDS["all"] ?? "";
  const term = SEARCH_TERMS[genre] || "podcast";

  try {
    let podcasts: any[] = [];

    // iTunes RSS top charts — genre-filtered
    try {
      const rssUrl = genreId
        ? `https://itunes.apple.com/${country}/rss/toppodcasts/limit=25/genre=${genreId}/json`
        : `https://itunes.apple.com/${country}/rss/toppodcasts/limit=25/json`;

      const rssRes = await fetch(rssUrl, {
        headers: { "User-Agent": "Mozilla/5.0 Podlens/1.0" }
      });

      if (rssRes.ok) {
        const rssData = await rssRes.json();
        const entries: any[] = rssData?.feed?.entry || [];

        if (entries.length > 0) {
          const ids = entries
            .map((e: any) => e.id?.attributes?.["im:id"])
            .filter(Boolean);
          let feedUrls: Record<string, string> = {};
          let itunesUrls: Record<string, string> = {};

          if (ids.length) {
            try {
              const lookupRes = await fetch(
                `https://itunes.apple.com/lookup?id=${ids.join(",")}&entity=podcast`,
                { headers: { "User-Agent": "Mozilla/5.0 Podlens/1.0" } }
              );
              if (lookupRes.ok) {
                const lookupData = await lookupRes.json();
                for (const r of (lookupData?.results || [])) {
                  if (r.trackId) {
                    if (r.feedUrl) feedUrls[String(r.trackId)] = r.feedUrl;
                    if (r.trackViewUrl) itunesUrls[String(r.trackId)] = r.trackViewUrl;
                  }
                }
              }
            } catch {}
          }

          podcasts = entries.map((e: any) => {
            const id = e.id?.attributes?.["im:id"] || "";
            const artwork = e["im:image"]?.[2]?.label || e["im:image"]?.[0]?.label || "";
            return {
              id,
              name:      e["im:name"]?.label || "",
              artist:    e["im:artist"]?.label || "",
              artwork,
              category:  e.category?.attributes?.label || genre,
              feedUrl:   feedUrls[id] || "",
              itunesUrl: itunesUrls[id] || "",
            };
          }).filter((p: any) => p.name);
        }
      }
    } catch {}

    // Fallback: iTunes search API
    if (!podcasts.length) {
      const searchUrl =
        `https://itunes.apple.com/search?term=${encodeURIComponent(term)}` +
        `&media=podcast&entity=podcast&limit=25&country=${country}`;
      const searchRes = await fetch(searchUrl, {
        headers: { "User-Agent": "Mozilla/5.0 Podlens/1.0" }
      });
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        podcasts = (searchData?.results || []).map((r: any) => ({
          id:        String(r.trackId || ""),
          name:      r.collectionName || r.trackName || "",
          artist:    r.artistName || "",
          artwork:   r.artworkUrl600 || r.artworkUrl100 || "",
          category:  r.primaryGenreName || genre,
          feedUrl:   r.feedUrl || "",
          itunesUrl: r.collectionViewUrl || r.trackViewUrl || "",
        })).filter((p: any) => p.name);
      }
    }

    return new Response(JSON.stringify({ podcasts, genre, region, country }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e), podcasts: [] }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/marketplace" };
