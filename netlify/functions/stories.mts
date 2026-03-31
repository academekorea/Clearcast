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
  "Stock market",
];

const FALLBACK_QUERIES = ["news", "politics", "technology", "business", "society"];

export default async (req: Request) => {
  const url = new URL(req.url);
  const query = url.searchParams.get("q") || "";
  const trending = url.searchParams.get("trending") === "1";

  if (trending) {
    return new Response(JSON.stringify({ topics: TRENDING_TOPICS }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  const searchQuery = query || "news";

  try {
    const doSearch = async (term: string) => {
      const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=podcast&entity=podcastEpisode&limit=20&sort=recent`;
      const res = await fetch(searchUrl, { headers: { "User-Agent": "Clearcast/1.0" } });
      const data = await res.json();
      return data.results || [];
    };

    let results = await doSearch(searchQuery);

    // Fallback: if no results, try first fallback query
    if (!results.length && query) {
      results = await doSearch(FALLBACK_QUERIES[0]);
    }

    const mapped = results.map((ep: any) => {
      const showName = ep.collectionName || ep.artistName || "Unknown show";
      const epTitle = ep.trackName || "Untitled episode";
      const artwork = ep.artworkUrl100?.replace("100x100", "300x300") || ep.artworkUrl60 || "";
      const releaseDate = ep.releaseDate
        ? new Date(ep.releaseDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : "";
      const duration = ep.trackTimeMillis ? Math.round(ep.trackTimeMillis / 60000) + " min" : "";
      const appleUrl = ep.trackViewUrl || "";
      const searchQ = encodeURIComponent(showName + " " + epTitle);
      const youtubeUrl = "https://www.youtube.com/results?search_query=" + searchQ;
      const spotifyUrl = "https://open.spotify.com/search/" + encodeURIComponent(epTitle) + "/episodes";
      const feedUrl = ep.feedUrl || "";
      return {
        showName, epTitle, artwork, releaseDate, duration,
        appleUrl, youtubeUrl, spotifyUrl, feedUrl,
        description: ep.shortDescription || ep.description || "",
      };
    });

    return new Response(JSON.stringify({ results: mapped, query: searchQuery }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Search failed", results: [] }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/stories" };
