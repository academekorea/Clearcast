import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const { showName, episodeTitle } = await req.json();
    const json = (data: object) =>
      new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });

    if (!showName) return json({ found: false });

    const clientId = Netlify.env.get("SPOTIFY_CLIENT_ID");
    const clientSecret = Netlify.env.get("SPOTIFY_CLIENT_SECRET");
    if (!clientId || !clientSecret) return json({ found: false });

    const cacheKey = "spotify-ep-" + hashStr((showName + (episodeTitle || "")).toLowerCase());
    const store = getStore("podlens-cache");

    // ── Cache check ──
    try {
      const cached = await store.get(cacheKey, { type: "json" }) as any;
      if (cached?.cachedAt && Date.now() - cached.cachedAt < 24 * 60 * 60 * 1000) {
        return json({ ...cached, fromCache: true });
      }
    } catch { /* cache miss */ }

    // ── Get Spotify access token ──
    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Authorization": "Basic " + btoa(`${clientId}:${clientSecret}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenRes.ok) return json({ found: false });
    const { access_token: token } = await tokenRes.json();

    // ── Search Spotify ──
    const q = encodeURIComponent(`${showName} ${episodeTitle || ""}`.trim().slice(0, 100));
    const searchRes = await fetch(
      `https://api.spotify.com/v1/search?q=${q}&type=episode&limit=1&market=US`,
      { headers: { "Authorization": `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }
    );
    if (!searchRes.ok) return json({ found: false });

    const searchData = await searchRes.json();
    const episode = searchData.episodes?.items?.[0];
    if (!episode) return json({ found: false });

    const result = {
      found: true,
      spotifyUri: episode.uri || "",
      spotifyUrl: episode.external_urls?.spotify || "",
      episodeName: episode.name || "",
      showName: episode.show?.name || showName,
      cachedAt: Date.now(),
    };

    try { await store.setJSON(cacheKey, result); } catch { /* ignore */ }

    return json(result);
  } catch (e: any) {
    return new Response(JSON.stringify({ found: false }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/find-episode" };
