import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Pre-analysis seeder — runs daily at 3am UTC
// Fetches latest 2 episodes from each CURATED_SHOW via RSS
// Submits uncached episodes for analysis to build community cache
// Target: ~48 episodes pre-analyzed = instant results for early users

const CURATED_FEEDS = [
  // News
  { name: "The Daily", feed: "https://feeds.simplecast.com/54nAGcIl" },
  { name: "Pod Save America", feed: "https://feeds.megaphone.fm/pod-save-america" },
  { name: "NPR Politics Podcast", feed: "https://feeds.npr.org/510310/podcast.xml" },
  { name: "The Ben Shapiro Show", feed: "https://feeds.megaphone.fm/WWO3519750917" },
  { name: "The Ezra Klein Show", feed: "https://feeds.simplecast.com/82FI35Px" },
  // Tech
  { name: "Lex Fridman Podcast", feed: "https://lexfridman.com/feed/podcast/" },
  { name: "Hard Fork", feed: "https://feeds.simplecast.com/l2i9YnTd" },
  { name: "Acquired", feed: "https://feeds.megaphone.fm/acquired" },
  { name: "All-In Podcast", feed: "https://feeds.megaphone.fm/allin" },
  // Business
  { name: "Planet Money", feed: "https://feeds.npr.org/510289/podcast.xml" },
  { name: "How I Built This", feed: "https://feeds.npr.org/510313/podcast.xml" },
  // Society
  { name: "We Can Do Hard Things", feed: "https://feeds.megaphone.fm/wecandohardthings" },
  { name: "Fresh Air", feed: "https://feeds.npr.org/381444908/podcast.xml" },
  // Health
  { name: "Huberman Lab", feed: "https://feeds.megaphone.fm/hubermanlab" },
  // Crime
  { name: "Crime Junkie", feed: "https://feeds.simplecast.com/MoTQX4v6" },
  { name: "Serial", feed: "https://feeds.simplecast.com/xl626A5P" },
];

interface Episode {
  title: string;
  audioUrl: string;
  showName: string;
  pubDate?: string;
}

// Extract latest N episodes from an RSS feed
async function getLatestEpisodes(feed: string, showName: string, count = 2): Promise<Episode[]> {
  try {
    const res = await fetch(feed, {
      headers: { "User-Agent": "Podlens/1.0 (podcast bias analysis; +https://podlens.app)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const xml = await res.text();

    const episodes: Episode[] = [];
    // Parse <item> blocks
    const items = xml.match(/<item[\s\S]*?<\/item>/g) || [];

    for (const item of items.slice(0, count * 3)) { // check more in case some have no audio
      if (episodes.length >= count) break;

      // Extract title
      const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
      const title = titleMatch?.[1]?.trim() || "Episode";

      // Extract audio URL from enclosure
      const enclosureMatch = item.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
      let audioUrl = enclosureMatch?.[1] || "";

      // Skip non-audio
      if (!audioUrl || !/\.(mp3|m4a|ogg|aac|wav)(\?|$)/i.test(audioUrl)) {
        // Try media:content
        const mediaMatch = item.match(/<media:content[^>]+url=["']([^"']+)["']/i);
        audioUrl = mediaMatch?.[1] || "";
      }

      if (!audioUrl) continue;

      const pubMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
      episodes.push({
        title: title.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
        audioUrl,
        showName,
        pubDate: pubMatch?.[1]?.trim(),
      });
    }

    return episodes;
  } catch {
    return [];
  }
}

// Canonical key for an audio URL
function canonicalKey(url: string): string {
  try {
    const u = new URL(url);
    if (/\.(mp3|m4a|ogg|wav|aac|opus)$/i.test(u.pathname)) {
      return `audio:${u.hostname}${u.pathname}`;
    }
  } catch {}
  return `url:${Buffer.from(url.toLowerCase().trim()).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 60)}`;
}

export default async (req: Request) => {
  const siteUrl = Netlify.env.get("URL") || "https://podlens.app";
  const internalSecret = Netlify.env.get("YOUTUBE_SERVICE_SECRET") || "";
  const store = getStore("podlens-jobs");

  console.log("[seed-analyses] Starting pre-analysis seed run");

  let submitted = 0;
  let skipped = 0;
  let errors = 0;

  for (const show of CURATED_FEEDS) {
    try {
      const episodes = await getLatestEpisodes(show.feed, show.name, 2);

      for (const ep of episodes) {
        const key = canonicalKey(ep.audioUrl);
        const canonKey = `canon:${key}`;

        // Check if already in community cache
        try {
          const cached = await store.get(canonKey, { type: "json" }) as any;
          if (cached?.status === "complete") {
            skipped++;
            console.log(`[seed] Already cached: ${ep.title.substring(0, 50)}`);
            continue;
          }
        } catch {}

        // Submit for analysis — fire and forget
        try {
          await fetch(`${siteUrl}/api/analyze`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-secret": internalSecret,
            },
            body: JSON.stringify({
              url: ep.audioUrl,
              episodeTitle: ep.title,
              showName: ep.showName,
              userId: null, // community analysis, not attributed to a user
              userPlan: "studio", // give full analysis
              isPreAnalysis: true,
            }),
            signal: AbortSignal.timeout(15000),
          });
          submitted++;
          console.log(`[seed] Submitted: ${ep.showName} — ${ep.title.substring(0, 40)}`);
          // Small delay to avoid hammering the pipeline
          await new Promise(r => setTimeout(r, 2000));
        } catch (e: any) {
          errors++;
          console.warn(`[seed] Submit failed: ${ep.showName}`, e?.message);
        }
      }
    } catch (e: any) {
      errors++;
      console.warn(`[seed] Feed error: ${show.name}`, e?.message);
    }
  }

  console.log(`[seed-analyses] Done. Submitted: ${submitted}, Skipped (cached): ${skipped}, Errors: ${errors}`);
};

export const config: Config = {};
