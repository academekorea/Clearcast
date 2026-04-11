import type { Config } from "@netlify/functions";

// Unified search — proxies to podcast-search logic (iTunes + Podcast Index)
// Also handles Podlens database lookup for pre-analyzed shows with bias scores

async function searchITunes(q: string, limit = 12): Promise<any[]> {
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=podcast&limit=${limit}&entity=podcast`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || [])
      .filter((r: any) => r.feedUrl)
      .map((r: any) => ({
        id: "itunes-" + r.collectionId,
        name: r.collectionName || r.trackName || "",
        host: r.artistName || "",
        artwork: r.artworkUrl600 || r.artworkUrl100 || "",
        feedUrl: r.feedUrl || "",
        genre: r.primaryGenreName || "",
        episodeCount: r.trackCount || 0,
        source: "apple",
        collectionId: r.collectionId,
      }));
  } catch { return []; }
}

async function searchPodcastIndex(q: string): Promise<any[]> {
  const apiKey = Netlify.env.get("PODCAST_INDEX_KEY") || "";
  const apiSecret = Netlify.env.get("PODCAST_INDEX_SECRET") || "";
  if (!apiKey || !apiSecret) return [];
  try {
    const authTime = Math.floor(Date.now() / 1000);
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
        id: "pi-" + f.id,
        name: f.title || "",
        host: f.author || f.ownerName || "",
        artwork: f.artwork || f.image || "",
        feedUrl: f.url,
        episodeCount: f.episodeCount || 0,
        source: "podcastindex",
      }));
  } catch { return []; }
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") || "";

  if (!q.trim() || q.trim().length < 2) {
    return new Response(JSON.stringify({ results: [], query: q }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const [itunesResults, piResults] = await Promise.all([
    searchITunes(q),
    searchPodcastIndex(q),
  ]);

  // Deduplicate by feed URL
  const seen = new Set<string>();
  const merged: any[] = [];
  for (const r of [...itunesResults, ...piResults]) {
    const key = (r.feedUrl || r.name || "").toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(r);
    }
  }

  return new Response(JSON.stringify({ results: merged.slice(0, 16), query: q }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
  });
};

export const config: Config = { path: "/api/search" };
