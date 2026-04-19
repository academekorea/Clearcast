import type { Config } from "@netlify/functions";

// Lightweight server-side iTunes artwork lookup
// Client-side iTunes API is blocked by CORS, so this proxies the request
// GET /api/artwork-lookup?q=Bad+Friends → { url: "https://...600x600bb.jpg" }

export default async (req: Request) => {
  const url = new URL(req.url);
  const query = url.searchParams.get("q") || "";

  if (!query) {
    return new Response(JSON.stringify({ url: null }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" },
    });
  }

  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=podcast&entity=podcast&limit=5`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) {
      return new Response(JSON.stringify({ url: null }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
      });
    }

    const data = await res.json();
    const results = data.results || [];
    if (!results.length) {
      return new Response(JSON.stringify({ url: null }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
      });
    }

    const nameLower = query.toLowerCase();
    const best =
      results.find((r: any) => r.collectionName?.toLowerCase() === nameLower) ||
      results.find((r: any) => r.collectionName?.toLowerCase().includes(nameLower)) ||
      results[0];

    const artworkUrl = best?.artworkUrl600 || best?.artworkUrl100 || null;

    return new Response(JSON.stringify({ url: artworkUrl }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" },
    });
  } catch {
    return new Response(JSON.stringify({ url: null }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
    });
  }
};

export const config: Config = { path: "/api/artwork-lookup" };
