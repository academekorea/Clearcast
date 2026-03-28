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
  "Stock market crash",
];

export default async (req: Request) => {
  const url = new URL(req.url);
  const query = url.searchParams.get("q") || "";
  const trending = url.searchParams.get("trending") === "1";

  if (trending) {
    return new Response(JSON.stringify({ topics: TRENDING_TOPICS }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  if (!query) {
    return new Response(JSON.stringify({ error: "Query required", results: [] }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=podcast&entity=podcastEpisode&limit=20&sort=recent`;
    const res = await fetch(searchUrl);
    const data = await res.json();

    const results = (data.results || []).map((ep: any) => {
      const showName = ep.collectionName || ep.artistName || "Unknown show";
      const epTitle = ep.trackName || "Untitled episode";
      const artwork = ep.artworkUrl100?.replace("100x100", "300x300") || ep.artworkUrl60 || "";
      const releaseDate = ep.releaseDate ? new Date(ep.releaseDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
      const duration = ep.trackTimeMillis ? Math.round(ep.trackTimeMillis / 60000) + " min" : "";
      const appleUrl = ep.trackViewUrl || "";
      const collectionId = ep.collectionId || "";
      const trackId = ep.trackId || "";

      // Construct platform links
      const searchQ = encodeURIComponent(showName + " " + epTitle);
      const youtubeUrl = "https://www.youtube.com/results?search_query=" + searchQ;
      const spotifyUrl = "https://open.spotify.com/search/" + encodeURIComponent(epTitle) + "/episodes";
      const feedUrl = ep.feedUrl || "";

      return {
        showName, epTitle, artwork, releaseDate, duration,
        appleUrl, youtubeUrl, spotifyUrl, feedUrl, collectionId, trackId,
        description: ep.shortDescription || ep.description || "",
      };
    });

    return new Response(JSON.stringify({ results, query }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Search failed", results: [] }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/stories" };
