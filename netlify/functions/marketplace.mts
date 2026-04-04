import type { Config } from "@netlify/functions";

const GENRE_TERMS: Record<string, string> = {
  "news": "news politics",
  "technology": "technology tech",
  "business": "business entrepreneurship",
  "society": "society culture",
  "true-crime": "true crime murder mystery",
  "comedy": "comedy humor",
  "education": "education learning",
  "health": "health wellness",
  "sports": "sports",
  "all": "top podcast",
};

const GENRE_IDS: Record<string, string> = {
  "news": "1311",
  "technology": "1318",
  "business": "1321",
  "society": "1323",
  "true-crime": "1488",
  "comedy": "1303",
  "education": "1304",
  "health": "1307",
  "sports": "1316",
  "all": "26",
};

export default async (req: Request) => {
  const url = new URL(req.url);
  const genre = url.searchParams.get("genre") || "news";
  const term = GENRE_TERMS[genre] || "podcast";
  const genreId = GENRE_IDS[genre] || "";

  try {
    // Try RSS top charts first
    let podcasts: any[] = [];
    
    try {
      const rssUrl = `https://itunes.apple.com/us/rss/toppodcasts/limit=20/genre=${genreId}/json`;
      const rssRes = await fetch(rssUrl, {
        headers: { "User-Agent": "Mozilla/5.0 Podlens/1.0" }
      });

      if (rssRes.ok) {
        const rssData = await rssRes.json();
        const entries = rssData?.feed?.entry || [];

        if (entries.length > 0) {
          // Batch lookup for feed URLs
          const ids = entries.map((e: any) => e.id?.attributes?.["im:id"]).filter(Boolean);
          let feedUrls: Record<string, string> = {};
          let itunesUrls: Record<string, string> = {};

          if (ids.length) {
            try {
              const lookupRes = await fetch(`https://itunes.apple.com/lookup?id=${ids.join(",")}&entity=podcast`, {
                headers: { "User-Agent": "Mozilla/5.0 Podlens/1.0" }
              });
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
            const artwork = e["im:image"]?.[2]?.label || e["im:image"]?.[1]?.label || e["im:image"]?.[0]?.label || "";
            const name = e["im:name"]?.label || "";
            const artist = e["im:artist"]?.label || "";
            const category = e.category?.attributes?.label || genre;
            return {
              id, name, artist, artwork, category,
              feedUrl: feedUrls[id] || "",
              itunesUrl: itunesUrls[id] || "",
            };
          }).filter((p: any) => p.name);
        }
      }
    } catch {}

    // Fallback: use search API
    if (!podcasts.length) {
      const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=podcast&entity=podcast&limit=20&country=us`;
      const searchRes = await fetch(searchUrl, {
        headers: { "User-Agent": "Mozilla/5.0 Podlens/1.0" }
      });
      
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        podcasts = (searchData?.results || []).map((r: any) => ({
          id: String(r.trackId || ""),
          name: r.collectionName || r.trackName || "",
          artist: r.artistName || "",
          artwork: r.artworkUrl600 || r.artworkUrl100 || "",
          category: r.primaryGenreName || genre,
          feedUrl: r.feedUrl || "",
          itunesUrl: r.collectionViewUrl || r.trackViewUrl || "",
        })).filter((p: any) => p.name);
      }
    }

    return new Response(JSON.stringify({ podcasts, genre }), {
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
