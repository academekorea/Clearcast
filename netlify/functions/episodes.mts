import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  const url = new URL(req.url);
  const feedUrl = url.searchParams.get("url");

  if (!feedUrl) {
    return new Response(JSON.stringify({ error: "URL required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const res = await fetch(feedUrl, {
      headers: { "User-Agent": "Clearcast/1.0", "Accept": "application/rss+xml, application/xml, text/xml, */*" }
    });
    const text = await res.text();

    // Parse episodes from RSS
    const items = text.match(/<item[\s\S]*?<\/item>/gi) || [];
    const episodes = items.slice(0, 10).map(item => {
      const title = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim() || "Untitled";
      const pubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim() || "";
      const duration = item.match(/<itunes:duration>([\s\S]*?)<\/itunes:duration>/i)?.[1]?.trim() || "";
      const enclosureMatch = item.match(/<enclosure[^>]+url="([^"]+)"/i);
      const audioUrl = enclosureMatch?.[1]?.replace(/&amp;/g, "&") || "";

      // Format date
      let dateStr = "";
      if (pubDate) {
        try { dateStr = new Date(pubDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); } catch {}
      }

      // Format duration
      let durationStr = duration;
      if (duration && !duration.includes(":")) {
        const secs = parseInt(duration);
        if (!isNaN(secs)) {
          const m = Math.floor(secs / 60);
          durationStr = `${m} min`;
        }
      }

      return { title, date: dateStr, duration: durationStr, audioUrl };
    }).filter(e => e.audioUrl);

    return new Response(JSON.stringify({ episodes }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Failed to fetch RSS feed" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/episodes" };
