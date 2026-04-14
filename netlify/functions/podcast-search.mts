import type { Config } from "@netlify/functions";

// Unified podcast search — hits iTunes + Podcast Index in parallel
// Returns deduplicated results with RSS feed URLs for direct analysis
// No API key needed for iTunes. Podcast Index uses API key if configured.

function json(data: object, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" }
  });
}

async function searchITunes(q: string): Promise<any[]> {
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=podcast&limit=10&entity=podcast`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || [])
      .filter((r: any) => r.feedUrl)
      .map((r: any) => ({
        name: r.collectionName || r.trackName || "",
        artist: r.artistName || "",
        artwork: r.artworkUrl600 || r.artworkUrl100 || "",
        feedUrl: r.feedUrl || "",
        itunesId: r.collectionId,
        genre: r.primaryGenreName || "",
        episodeCount: r.trackCount || 0,
        source: "itunes",
      }));
  } catch { return []; }
}

async function searchPodcastIndex(q: string): Promise<any[]> {
  const apiKey = Netlify.env.get("PODCAST_INDEX_KEY") || "";
  const apiSecret = Netlify.env.get("PODCAST_INDEX_SECRET") || "";
  if (!apiKey || !apiSecret) return []; // Gracefully skip if not configured

  try {
    const authTime = Math.floor(Date.now() / 1000);
    // Podcast Index auth: SHA-1 hash of apiKey + apiSecret + authTime
    const encoder = new TextEncoder();
    const data = encoder.encode(apiKey + apiSecret + authTime.toString());
    const hashBuffer = await crypto.subtle.digest("SHA-1", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const authHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

    const res = await fetch(
      `https://api.podcastindex.org/api/1.0/search/byterm?q=${encodeURIComponent(q)}&max=10&clean`,
      {
        headers: {
          "X-Auth-Key": apiKey,
          "X-Auth-Date": authTime.toString(),
          "Authorization": authHash,
          "User-Agent": "PodLens/1.0",
        },
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) return [];
    const data2 = await res.json();
    return (data2.feeds || [])
      .filter((f: any) => f.url)
      .map((f: any) => ({
        name: f.title || "",
        artist: f.author || f.ownerName || "",
        artwork: f.artwork || f.image || "",
        feedUrl: f.url,
        episodeCount: f.episodeCount || 0,
        source: "podcastindex",
      }));
  } catch { return []; }
}

function mapRssEntries(entries: any[]): any[] {
  return (entries || [])
    .map((item: any) => ({
      name: item["im:name"]?.label || "",
      artist: item["im:artist"]?.label || "",
      artwork: item["im:image"]?.[2]?.label || item["im:image"]?.[1]?.label || item["im:image"]?.[0]?.label || "",
      feedUrl: "",
      itunesId: item.id?.attributes?.["im:id"] || "",
      genre: item.category?.attributes?.label || "",
      episodeCount: 0,
      source: "itunes-rss",
    }))
    .filter((s) => s.name);
}

async function fetchGenreTop(genreId: string): Promise<any[]> {
  try {
    const res = await fetch(
      `https://itunes.apple.com/us/rss/toppodcasts/limit=25/genre=${genreId}/json`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return mapRssEntries(data.feed?.entry || []);
  } catch { return []; }
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") || "";
  const genre = url.searchParams.get("genre") || "";

  // Genre-based lookup — use iTunes RSS top charts
  if (genre) {
    const results = await fetchGenreTop(genre);
    return json({ results: results.slice(0, 12), query: q });
  }

  if (!q.trim() || q.trim().length < 2) {
    return json({ results: [], query: q });
  }

  // Search both sources in parallel
  const [itunesResults, piResults] = await Promise.all([
    searchITunes(q),
    searchPodcastIndex(q),
  ]);

  // Deduplicate by feed URL and show name
  const seen = new Set<string>();
  const merged: any[] = [];

  for (const r of [...itunesResults, ...piResults]) {
    const key = (r.feedUrl || r.name || "").toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(r);
    }
  }

  return json({ results: merged.slice(0, 12), query: q });
};

export const config: Config = { path: "/api/podcast-search" };
