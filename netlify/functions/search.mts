import type { Config } from "@netlify/functions";
import { getSupabaseAdmin } from "./lib/supabase.js";

const HEADERS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const region = url.searchParams.get("region") || "us";
  const userId = url.searchParams.get("userId") || "";

  if (q.length < 2) return json({ results: [], query: q });

  const country = region === "kr" || region.includes("KR") ? "kr" : "us";
  const ytKey = Netlify.env.get("YOUTUBE_API_KEY") || "";

  const [iTunesRes, youtubeRes, podlensRes, libraryRes] = await Promise.allSettled([

    // SOURCE 1: iTunes Search API
    fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=podcast&limit=10&country=${country}`,
      { signal: AbortSignal.timeout(6000) }
    ).then(r => r.json()).then((data: any) =>
      (data.results || [])
        .filter((item: any) => item.kind === "podcast" || item.wrapperType === "collection")
        .slice(0, 8)
        .map((item: any) => ({
          id: `itunes-${item.collectionId}`,
          name: item.collectionName || item.trackName || "",
          host: item.artistName || "",
          artwork: item.artworkUrl600 || item.artworkUrl100 || "",
          feedUrl: item.feedUrl || "",
          category: item.primaryGenreName || "",
          episodeCount: item.trackCount || 0,
          source: "apple",
          sourceLabel: "Apple Podcasts",
        }))
    ).catch(() => [] as any[]),

    // SOURCE 2: YouTube channel search
    ytKey
      ? fetch(
          `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q + " podcast")}&type=channel&maxResults=5&key=${ytKey}`,
          { signal: AbortSignal.timeout(6000) }
        ).then(r => r.json()).then((data: any) =>
          (data.items || []).map((item: any) => ({
            id: `youtube-${item.id.channelId}`,
            name: item.snippet.title || "",
            host: item.snippet.title || "",
            artwork: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url || "",
            channelId: item.id.channelId,
            description: (item.snippet.description || "").slice(0, 120),
            source: "youtube",
            sourceLabel: "YouTube",
          }))
        ).catch(() => [] as any[])
      : Promise.resolve([] as any[]),

    // SOURCE 3: Podlens analyzed shows (Supabase)
    (async () => {
      const sb = getSupabaseAdmin();
      if (!sb) return [];
      const { data } = await sb
        .from("shows")
        .select("id, name, artwork_url, feed_url, avg_bias_score, avg_bias_label, total_analyses")
        .ilike("name", `%${q}%`)
        .order("total_analyses", { ascending: false })
        .limit(5);
      return (data || []).map((s: any) => ({
        id: `podlens-${s.id}`,
        name: s.name || "",
        artwork: s.artwork_url || "",
        feedUrl: s.feed_url || "",
        biasScore: s.avg_bias_score ?? null,
        biasLabel: s.avg_bias_label || null,
        analysisCount: s.total_analyses || 0,
        source: "podlens",
        sourceLabel: "Analyzed on Podlens",
      }));
    })(),

    // SOURCE 4: User's analysis history (if logged in)
    (async () => {
      if (!userId) return [];
      const sb = getSupabaseAdmin();
      if (!sb) return [];
      const { data } = await sb
        .from("analyses")
        .select("show_name, show_artwork")
        .eq("user_id", userId)
        .ilike("show_name", `%${q}%`)
        .limit(5);
      const seen = new Set<string>();
      return (data || [])
        .filter((a: any) => {
          const k = (a.show_name || "").toLowerCase();
          if (!k || seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .map((a: any) => ({
          id: `library-${a.show_name}`,
          name: a.show_name || "",
          artwork: a.show_artwork || "",
          source: "library",
          sourceLabel: "Your library",
        }));
    })(),
  ]);

  // Combine in priority order: library → podlens analyzed → iTunes → YouTube
  const all = [
    ...(libraryRes.status === "fulfilled" ? libraryRes.value : []),
    ...(podlensRes.status === "fulfilled" ? podlensRes.value : []),
    ...(iTunesRes.status === "fulfilled" ? iTunesRes.value : []),
    ...(youtubeRes.status === "fulfilled" ? youtubeRes.value : []),
  ];

  // Deduplicate by normalized name
  const seenNames = new Set<string>();
  const deduped = all.filter(r => {
    const key = (r.name || "").toLowerCase().trim();
    if (!key || seenNames.has(key)) return false;
    seenNames.add(key);
    return true;
  });

  return json({
    results: deduped.slice(0, 15),
    query: q,
    sources: {
      library: libraryRes.status === "fulfilled" ? libraryRes.value.length : 0,
      podlens: podlensRes.status === "fulfilled" ? podlensRes.value.length : 0,
      apple: iTunesRes.status === "fulfilled" ? iTunesRes.value.length : 0,
      youtube: youtubeRes.status === "fulfilled" ? youtubeRes.value.length : 0,
    },
  });
};

export const config: Config = { path: "/api/search" };
