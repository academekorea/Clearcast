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
  { name: "The Megyn Kelly Show", feed: "https://feeds.simplecast.com/RV1USAfC" },
  { name: "Pod Save the World", feed: "https://audioboom.com/channels/5166626.rss" },
  { name: "The Bulwark Podcast", feed: "https://audioboom.com/channels/5114286.rss" },
  { name: "America First with Sebastian Gorka", feed: "https://www.omnycontent.com/d/playlist/5e27a451-e6e6-4c51-aa03-a7370003783c/e6f365c0-eb93-462f-8ca1-b15600f02fd2/89b00503-0e29-46e7-b9f0-b15600f09934/podcast.rss" },
  // Tech
  { name: "Lex Fridman Podcast", feed: "https://lexfridman.com/feed/podcast/" },
  { name: "Hard Fork", feed: "https://feeds.simplecast.com/l2i9YnTd" },
  { name: "Acquired", feed: "https://feeds.megaphone.fm/acquired" },
  { name: "All-In Podcast", feed: "https://feeds.megaphone.fm/allin" },
  { name: "Darknet Diaries", feed: "https://feeds.megaphone.fm/darknetdiaries" },
  { name: "This Week in Tech", feed: "https://rss.pdrl.fm/acfcd4/feeds.twit.tv/twit.xml" },
  { name: "The Tim Ferriss Show", feed: "https://rss.art19.com/tim-ferriss-show" },
  { name: "Masters of Scale", feed: "https://rss.art19.com/masters-of-scale" },
  { name: "My First Million", feed: "https://feeds.megaphone.fm/HS2300184645" },
  // Business
  { name: "Planet Money", feed: "https://feeds.npr.org/510289/podcast.xml" },
  { name: "How I Built This", feed: "https://feeds.npr.org/510313/podcast.xml" },
  { name: "The Knowledge Project", feed: "https://feeds.megaphone.fm/FSMI7575968096" },
  { name: "We Study Billionaires", feed: "https://feeds.megaphone.fm/PPLLC8974708240" },
  { name: "Founders", feed: "https://feeds.megaphone.fm/DSLLC6297708582" },
  { name: "Business Wars", feed: "https://rss.art19.com/business-wars" },
  { name: "The Prof G Pod", feed: "https://feeds.megaphone.fm/WWO6655869236" },
  // Society
  { name: "We Can Do Hard Things", feed: "https://feeds.megaphone.fm/wecandohardthings" },
  { name: "Fresh Air", feed: "https://feeds.npr.org/381444908/podcast.xml" },
  { name: "Radiolab", feed: "https://feeds.wnyc.org/radiolab" },
  { name: "SmartLess", feed: "https://feeds.simplecast.com/hNaFxXpO" },
  { name: "Revisionist History", feed: "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/0e563f45-9d14-4ce8-8ef0-ae32006cd7e7/0d4cc74d-fff7-4b89-8818-ae32006cd7f0/podcast.rss" },
  { name: "Hidden Brain", feed: "https://feeds.simplecast.com/kwWc0lhf" },
  { name: "On Being", feed: "https://feeds.simplecast.com/AuAxH_Bf" },
  { name: "Armchair Expert", feed: "https://rss.art19.com/armchair-expert" },
  { name: "Stuff You Should Know", feed: "https://feeds.megaphone.fm/stuffyoushouldknow" },
  // Health
  { name: "Huberman Lab", feed: "https://feeds.megaphone.fm/hubermanlab" },
  { name: "Maintenance Phase", feed: "https://feeds.megaphone.fm/maintenancephase" },
  { name: "On Purpose", feed: "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/32f1779e-bc01-4d36-89e6-afcb01070c82/e0c8382f-48d4-42bb-89d5-afcb01075cb4/podcast.rss" },
  { name: "The Peter Attia Drive", feed: "https://rss.libsyn.com/shows/121729/destinations/713489.xml" },
  { name: "Unlocking Us", feed: "https://feeds.megaphone.fm/GLT4889391284" },
  { name: "Feel Better, Live More", feed: "https://feeds.megaphone.fm/feelbetterlivemore" },
  { name: "ZOE Science & Nutrition", feed: "https://feeds.megaphone.fm/ZOELIMITED9301524082" },
  { name: "The Doctor's Farmacy", feed: "https://feeds.megaphone.fm/thedoctorsfarmacy" },
  // Crime
  { name: "Crime Junkie", feed: "https://feeds.simplecast.com/MoTQX4v6" },
  { name: "Serial", feed: "https://feeds.simplecast.com/xl626A5P" },
  { name: "My Favorite Murder", feed: "https://feeds.megaphone.fm/myfavoritemurder" },
  { name: "Casefile True Crime", feed: "https://feeds.acast.com/public/shows/679acff465f74095106abfaa" },
  { name: "Generation Why", feed: "https://anchor.fm/s/1ff7e044/podcast/rss" },
  { name: "Your Own Backyard", feed: "https://rss.libsyn.com/shows/173939/destinations/1171880.xml" },
  { name: "Cold", feed: "https://feed.cdnstream1.com/zjb/feed/download/87/b7/29/87b729c2-017f-43cb-bb5a-be3d8ff5aaf6.xml" },
  // Comedy
  { name: "Conan O'Brien Needs A Friend", feed: "https://feeds.simplecast.com/dHoohVNH" },
  { name: "This American Life", feed: "https://www.thisamericanlife.org/podcast/rss.xml" },
  { name: "Wait Wait... Don't Tell Me!", feed: "https://feeds.npr.org/344098539/podcast.xml" },
  { name: "Call Her Daddy", feed: "https://feeds.simplecast.com/mKn_QmLS" },
  { name: "The Joe Rogan Experience", feed: "https://feeds.megaphone.fm/GLT1412515089" },
  { name: "Freakonomics Radio", feed: "https://feeds.simplecast.com/Y8lFbOT4" },
  { name: "Office Ladies", feed: "https://feeds.megaphone.fm/office-ladies" },
  // Sports
  { name: "The Bill Simmons Podcast", feed: "https://feeds.megaphone.fm/billsimmons" },
  { name: "Pardon My Take", feed: "https://feeds.megaphone.fm/pardonmytake" },
  { name: "First Take", feed: "https://feeds.megaphone.fm/ESP1539938155" },
  { name: "The Ringer NFL Show", feed: "https://feeds.megaphone.fm/the-ringer-nfl-show" },
  { name: "Pardon The Interruption", feed: "https://feeds.megaphone.fm/ESP7239282233" },
  { name: "The Dan Patrick Show", feed: "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/2c906e2b-2518-466c-a457-ae320005bafb/4818243e-950b-4fc4-8a22-ae320005bb09/podcast.rss" },
  { name: "Fantasy Footballers", feed: "https://feeds.simplecast.com/sw7PGWfw" },
  { name: "New Heights", feed: "https://rss.art19.com/new-heights" },
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
      // Accept any URL that looks like audio — extension OR known audio CDN patterns
      const looksLikeAudio = /\.(mp3|m4a|ogg|aac|wav|opus)/i.test(audioUrl)
        || /\/audio\//i.test(audioUrl)
        || /\/(stream|episode|media|podcast)\//i.test(audioUrl)
        || audioUrl.includes('cdn.simplecast.com')
        || audioUrl.includes('megaphone.fm')
        || audioUrl.includes('pdst.fm')
        || audioUrl.includes('chrt.fm');
      if (!audioUrl || !looksLikeAudio) {
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
  // Verify internal trigger — reject if secret not configured or doesn't match
  const secret = Netlify.env.get("YOUTUBE_SERVICE_SECRET") || "";
  const provided = req.headers.get("x-internal-trigger") || req.headers.get("x-internal-secret") || "";
  if (!secret || provided !== secret) {
    console.warn("[seed-analyses] Unauthorized trigger attempt");
    return; // Background functions return void — just exit silently
  }

  const siteUrl = Netlify.env.get("URL") || "https://podlens.app";
  const internalSecret = Netlify.env.get("YOUTUBE_SERVICE_SECRET") || "";
  const store = getStore("podlens-jobs");

  console.log("[seed-analyses] Starting pre-analysis seed run");

  const MAX_CONCURRENT = 5;  // Process 5 episodes at a time
  const MAX_TOTAL = 20;      // Max episodes per run (background fn has 15 min)
  let submitted = 0;
  let completed = 0;
  let skipped = 0;
  let errors = 0;

  // Phase 1: Collect uncached episodes across all shows
  const toAnalyze: Episode[] = [];
  for (const show of CURATED_FEEDS) {
    if (toAnalyze.length >= MAX_TOTAL) break;
    try {
      const episodes = await getLatestEpisodes(show.feed, show.name, 2);
      for (const ep of episodes) {
        if (toAnalyze.length >= MAX_TOTAL) break;
        const key = canonicalKey(ep.audioUrl);
        const canonKey = `canon:${key}`;
        try {
          const cached = await store.get(canonKey, { type: "json" }) as any;
          if (cached?.status === "complete") {
            skipped++;
            continue;
          }
        } catch {}
        toAnalyze.push(ep);
      }
    } catch (e: any) {
      console.warn(`[seed] Feed error: ${show.name}`, e?.message);
    }
  }

  console.log(`[seed] Found ${toAnalyze.length} uncached episodes, ${skipped} already cached`);

  // Phase 2: Process in batches — submit, then poll until complete
  for (let i = 0; i < toAnalyze.length; i += MAX_CONCURRENT) {
    const batch = toAnalyze.slice(i, i + MAX_CONCURRENT);

    // Submit all in batch
    const jobs: { ep: Episode; jobId: string }[] = [];
    for (const ep of batch) {
      try {
        const res = await fetch(`${siteUrl}/api/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
          body: JSON.stringify({
            url: ep.audioUrl, episodeTitle: ep.title, showName: ep.showName,
            userId: null, isPreAnalysis: true,
          }),
          signal: AbortSignal.timeout(15000),
        });
        const d = await res.json().catch(() => ({})) as any;
        if (d?.jobId) {
          jobs.push({ ep, jobId: d.jobId });
          submitted++;
          console.log(`[seed] Submitted: ${ep.showName} — ${ep.title.substring(0, 40)} (${d.jobId})`);
        }
      } catch (e: any) {
        errors++;
        console.warn(`[seed] Submit failed: ${ep.showName}`, e?.message);
      }
    }

    // Poll all jobs in batch concurrently until done or timeout
    const pending = new Set(jobs.map(j => j.jobId));
    let pollRound = 0;
    const maxRounds = 40; // ~6.5 minutes max per batch (10s intervals)
    while (pending.size > 0 && pollRound < maxRounds) {
      await new Promise(r => setTimeout(r, 10000));
      pollRound++;
      const checks = [...pending].map(async (jobId) => {
        try {
          const res = await fetch(`${siteUrl}/api/status?jobId=${jobId}`, { signal: AbortSignal.timeout(15000) });
          const d = await res.json().catch(() => ({})) as any;
          if (d?.status === "complete") {
            pending.delete(jobId);
            completed++;
            const j = jobs.find(x => x.jobId === jobId);
            console.log(`[seed] Complete: ${j?.ep.showName} — ${j?.ep.title.substring(0, 40)}`);
          } else if (d?.status === "error") {
            pending.delete(jobId);
            errors++;
            console.warn(`[seed] Error: ${jobId}`, d?.error);
          }
        } catch {}
      });
      await Promise.all(checks);
    }
    if (pending.size > 0) {
      console.warn(`[seed] Batch timed out, ${pending.size} still pending`);
    }
  }

  console.log(`[seed-analyses] Done. Submitted: ${submitted}, Completed: ${completed}, Skipped: ${skipped}, Errors: ${errors}`);
};

export const config: Config = {};  // HTTP-triggered only — seed-scheduler.mts handles cron
