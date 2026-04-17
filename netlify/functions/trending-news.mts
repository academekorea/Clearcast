import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const CACHE_KEY = "trending-news-topics";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Hardcoded fallback — used when CURRENTS_API_KEY is missing or Currents fails.
// Mirrors what the frontend used to render directly. Safe to ship without a key.
const FALLBACK_TOPICS = [
  "Trump Tariffs Impact", "AI Regulation Debate", "Federal Reserve Rate Decision",
  "Gaza Ceasefire Talks", "TikTok Ban Ruling", "Boeing Whistleblower",
  "Ukraine NATO Membership", "Student Loan Forgiveness", "Tesla Sales Drop",
  "Border Security Bill", "Supreme Court Ruling", "Tech Layoffs 2026",
  "Medicare Drug Prices", "China Taiwan Tensions", "Election Polling",
  "Housing Market Crisis", "SpaceX Starship Launch", "Climate Summit",
];

// Words to exclude from extracted entity counts — calendar, generic news verbs,
// and common short article fragments that look like proper nouns to the regex.
const STOPWORDS = new Set([
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
  "Today", "Tomorrow", "Yesterday", "This", "That", "These", "Those",
  "New", "Old", "First", "Second", "Third", "Last", "Next",
  "News", "Report", "Update", "Breaking", "Live", "Watch",
  "How", "Why", "What", "When", "Where", "Who", "Which",
  "The", "And", "But", "For", "With", "From", "After", "Before",
  "Read", "More", "Here", "There", "Now", "Then",
  "Mr", "Mrs", "Ms", "Dr", "Sen", "Rep",
  "AM", "PM", "ET", "PT", "EST", "PDT",
  "US", "USA", "U.S.", "America", "American", "Americans",
  // Generic single-word nouns that aren't meaningful as trending topics
  "Company", "Programming", "Photography", "People", "History", "Science",
  "Technology", "Business", "Health", "Sports", "Music", "Education",
  "Government", "Police", "Officials", "According", "Sources", "Says",
  "Show", "Podcast", "Episode", "Video", "Photo", "Image",
  "Part", "Season", "Series", "Chapter", "Volume", "Section",
  // US states/cities that appear too generically
  "Pennsylvania", "Philadelphia", "California", "Florida", "Texas",
  "Chicago", "Boston", "Atlanta", "Houston", "Phoenix", "Denver",
  "Oregon", "Michigan", "Ohio", "Virginia", "Maryland", "Georgia",
  "Carolina", "Minnesota", "Wisconsin", "Indiana", "Tennessee", "Missouri",
  "Alabama", "Kentucky", "Louisiana", "Connecticut", "Iowa", "Colorado",
  // Podcast/creator names that leak from news articles about podcasts
  "Huberman Lab", "Dwarkesh Patel", "Joe Rogan", "Lex Fridman",
  "Ben Shapiro", "Megyn Kelly", "Tim Ferriss", "Conan Brien",
  "Alex Cooper", "Call Her Daddy", "Tucker Carlson",
]);

interface CurrentsArticle {
  id: string;
  title: string;
  description: string;
  category: string[];
  published: string;
}

function extractTopics(articles: CurrentsArticle[]): string[] {
  const counts: Record<string, number> = {};
  // Match runs of capitalized words (1–3 words long): "Trump", "Federal Reserve",
  // "Supreme Court", "European Union". Excludes single-letter and ALL-CAPS noise.
  const re = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g;

  for (const a of articles) {
    const seenInTitle = new Set<string>(); // dedupe within one article
    const text = a.title || "";
    const matches = text.match(re) || [];
    for (const raw of matches) {
      const phrase = raw.trim();
      if (phrase.length < 3) continue;
      if (STOPWORDS.has(phrase)) continue;
      // Skip if every word is a stopword (e.g. "This Week")
      const words = phrase.split(/\s+/);
      if (words.every((w) => STOPWORDS.has(w))) continue;
      if (seenInTitle.has(phrase)) continue;
      seenInTitle.add(phrase);
      counts[phrase] = (counts[phrase] || 0) + 1;
    }
  }

  // Sort by frequency, then alphabetical for stable ordering at ties
  const sorted = Object.entries(counts)
    .filter(([, c]) => c >= 2) // require at least 2 mentions to be "trending"
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t);

  // Dedupe near-substrings: if "Trump Administration" exists, drop standalone "Trump"
  // (only when the longer phrase appears earlier / more frequently)
  const final: string[] = [];
  for (const topic of sorted) {
    const isSubstringOfBetter = final.some((t) => t.includes(topic) && t !== topic);
    if (!isSubstringOfBetter) final.push(topic);
  }

  return final.slice(0, 18);
}

function json(data: object, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
  });
}

export default async () => {
  // Try cache first (Netlify Blobs)
  try {
    const store = getStore("podlens-cache");
    const cached = (await store.get(CACHE_KEY, { type: "json" })) as
      | { ts: number; topics: string[]; source: string }
      | null;
    if (cached && cached.ts && Date.now() - cached.ts < CACHE_TTL_MS && cached.topics?.length) {
      return json({ topics: cached.topics, source: cached.source, cached: true });
    }
  } catch {}

  const apiKey = Netlify.env.get("CURRENTS_API_KEY");
  if (!apiKey) {
    // No key configured — return fallback. Frontend renders these directly,
    // and per-topic clicks still work because the hero fetches via /api/stories.
    return json({ topics: FALLBACK_TOPICS, source: "fallback-no-key" });
  }

  try {
    // Pull latest English news. Currents free tier allows 600 calls/day,
    // and we cache for 1 hour, so worst case 24 calls/day.
    const url = new URL("https://api.currentsapi.services/v1/latest-news");
    url.searchParams.set("language", "en");
    url.searchParams.set("apiKey", apiKey);

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Currents API ${res.status}`);
    const data = (await res.json()) as { news?: CurrentsArticle[] };
    const articles = data.news || [];
    if (articles.length < 5) throw new Error("too few articles");

    const topics = extractTopics(articles);
    const finalTopics = topics.length >= 8 ? topics : [...topics, ...FALLBACK_TOPICS].slice(0, 18);

    // Cache result
    try {
      const store = getStore("podlens-cache");
      await store.setJSON(CACHE_KEY, {
        ts: Date.now(),
        topics: finalTopics,
        source: "currents",
      });
    } catch {}

    return json({ topics: finalTopics, source: "currents" });
  } catch (e) {
    // On any error, still return something usable
    return json({
      topics: FALLBACK_TOPICS,
      source: "fallback-error",
      error: e instanceof Error ? e.message : "unknown",
    });
  }
};

export const config: Config = { path: "/api/trending-news" };
