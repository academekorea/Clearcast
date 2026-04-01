import type { Config } from "@netlify/functions";

function formatDuration(ms: number): string {
  if (!ms) return "";
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const query = url.searchParams.get("q") || "news";

  try {
    const searchUrl = new URL("https://itunes.apple.com/search");
    searchUrl.searchParams.set("term", query + " podcast");
    searchUrl.searchParams.set("media", "podcast");
    searchUrl.searchParams.set("entity", "podcastEpisode");
    searchUrl.searchParams.set("limit", "20");
    searchUrl.searchParams.set("country", "us");

    const res = await fetch(searchUrl.toString());
    if (!res.ok) throw new Error(`iTunes search failed: ${res.status}`);
    const data = await res.json();
    const items: any[] = data.results || [];

    const results = items.map((it: any) => {
      const releaseDate = it.releaseDate
        ? new Date(it.releaseDate).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "";
      const spotifyUrl =
        "https://open.spotify.com/search/" +
        encodeURIComponent(it.trackName || "") +
        "/episodes";

      return {
        showName: it.collectionName || "Unknown show",
        epTitle: it.trackName || "Untitled",
        artwork: it.artworkUrl600 || it.artworkUrl160 || "",
        releaseDate,
        duration: formatDuration(it.trackTimeMillis || 0),
        youtubeUrl: "",
        spotifyUrl,
        appleUrl: it.trackViewUrl || "",
        feedUrl: it.episodeUrl || "",
        description: it.shortDescription || it.description || "",
      };
    });

    return new Response(JSON.stringify({ results, query }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Search failed", results: [] }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config: Config = { path: "/api/stories" };
