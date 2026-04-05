import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const json = (data: object, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

  try {
    const { spotifyAccessToken, userId, userPlan } = await req.json();
    if (!spotifyAccessToken || !userId) return json({ error: "Missing required fields" }, 400);

    const store = getStore("podlens-cache");
    const cacheKey = `spotify-import-${userId}`;

    // Check 1-hour cache
    try {
      const cached = await store.get(cacheKey, { type: "json" }) as any;
      if (cached?.cachedAt && Date.now() - cached.cachedAt < 60 * 60 * 1000) {
        return json({ ...cached, fromCache: true });
      }
    } catch {}

    const headers = { Authorization: `Bearer ${spotifyAccessToken}` };

    // Fetch followed shows + recently played in parallel
    const [showsRes, recentRes] = await Promise.allSettled([
      fetch("https://api.spotify.com/v1/me/shows?limit=50", {
        headers, signal: AbortSignal.timeout(8000),
      }),
      fetch("https://api.spotify.com/v1/me/player/recently-played?limit=50&type=episode", {
        headers, signal: AbortSignal.timeout(8000),
      }),
    ]);

    const followedShows: any[] = [];
    if (showsRes.status === "fulfilled" && showsRes.value.ok) {
      const data = await showsRes.value.json();
      for (const item of (data.items || [])) {
        const show = item.show;
        if (!show) continue;
        followedShows.push({
          spotifyId: show.id,
          name: show.name,
          publisher: show.publisher || "",
          artwork: show.images?.[0]?.url || "",
          description: (show.description || "").slice(0, 200),
          totalEpisodes: show.total_episodes || 0,
          spotifyUrl: show.external_urls?.spotify || "",
        });
      }
    }

    const recentShowNames = new Set<string>();
    if (recentRes.status === "fulfilled" && recentRes.value.ok) {
      const data = await recentRes.value.json();
      for (const item of (data.items || [])) {
        if (item.track?.show?.name) recentShowNames.add(item.track.show.name);
      }
    }

    // Cross-reference with Podlens database (check first 20 shows for performance)
    const analysisStore = getStore("podlens-cache");
    const showResults: any[] = [];

    for (const show of followedShows.slice(0, 20)) {
      const showKey = `show-meta-${show.spotifyId}`;
      let podlensData: any = null;
      try { podlensData = await analysisStore.get(showKey, { type: "json" }); } catch {}

      showResults.push({
        ...show,
        analyzed: !!podlensData,
        biasData: podlensData ? {
          leftPct: podlensData.leftPct || 0,
          centerPct: podlensData.centerPct || 0,
          rightPct: podlensData.rightPct || 0,
          label: podlensData.biasLabel || "Mostly balanced",
        } : null,
      });
    }

    // Preliminary fingerprint — Creator+ only
    const isPaid = ["creator", "operator", "studio"].includes(userPlan || "");
    const fingerprintLocked = !isPaid;
    let preliminaryFingerprint: any = null;

    if (!fingerprintLocked) {
      const analyzed = showResults.filter(s => s.analyzed && s.biasData);
      if (analyzed.length > 0) {
        const totL = analyzed.reduce((s, r) => s + r.biasData.leftPct, 0);
        const totC = analyzed.reduce((s, r) => s + r.biasData.centerPct, 0);
        const totR = analyzed.reduce((s, r) => s + r.biasData.rightPct, 0);
        const n = analyzed.length;
        preliminaryFingerprint = {
          leftPct: Math.round(totL / n),
          centerPct: Math.round(totC / n),
          rightPct: Math.round(totR / n),
          basedOn: n,
        };
      }
    }

    // Suggest unanalyzed shows from the followed list
    const suggestedAnalyses = showResults
      .filter(s => !s.analyzed)
      .slice(0, 3)
      .map(s => ({ name: s.name, artwork: s.artwork, spotifyUrl: s.spotifyUrl }));

    const result = {
      followedShows: showResults.slice(0, 12),
      preliminaryFingerprint,
      fingerprintLocked,
      suggestedAnalyses,
      totalFollowed: followedShows.length,
      recentShowCount: recentShowNames.size,
      cachedAt: Date.now(),
    };

    try { await store.setJSON(cacheKey, result); } catch {}

    return json(result);
  } catch (e: any) {
    return json({ error: "Import failed", details: e?.message || "unknown" }, 500);
  }
};

export const config: Config = { path: "/api/spotify-import" };
