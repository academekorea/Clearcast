import type { Config } from "@netlify/functions";
import { getSupabaseAdmin } from "./lib/supabase.js";

const GENRE_MAP: Record<string, string> = {
  technology: "1318",
  tech: "1318",
  news: "1489",
  politics: "1489",
  business: "1321",
  comedy: "1303",
  society: "1324",
  health: "1307",
  sports: "1545",
  "true-crime": "1488",
  crime: "1488",
  science: "1533",
  history: "1464",
  education: "1304",
};

interface ShowItem {
  id: string;
  name: string;
  host: string;
  artwork: string;
  category: string;
  itunesId: string;
  country: string;
}

function mapEntries(entries: any[], country: string): ShowItem[] {
  return (entries || [])
    .map((item: any) => ({
      id: item.id?.attributes?.["im:id"] || "",
      name: item["im:name"]?.label || "",
      host: item["im:artist"]?.label || "",
      artwork:
        item["im:image"]?.[2]?.label ||
        item["im:image"]?.[1]?.label ||
        item["im:image"]?.[0]?.label ||
        "",
      category: item.category?.attributes?.label || "",
      itunesId: item.id?.attributes?.["im:id"] || "",
      country,
    }))
    .filter((s) => s.id && s.name);
}

async function fetchTop(country: string): Promise<ShowItem[]> {
  try {
    const res = await fetch(
      `https://itunes.apple.com/${country}/rss/toppodcasts/limit=10/json`,
      { signal: AbortSignal.timeout(6000) }
    );
    const data: any = await res.json();
    return mapEntries(data.feed?.entry || [], country);
  } catch {
    return [];
  }
}

async function fetchByGenre(country: string, genreId: string): Promise<ShowItem[]> {
  try {
    const res = await fetch(
      `https://itunes.apple.com/${country}/rss/toppodcasts/limit=10/genre=${genreId}/json`,
      { signal: AbortSignal.timeout(6000) }
    );
    const data: any = await res.json();
    return mapEntries(data.feed?.entry || [], country);
  } catch {
    return [];
  }
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const region = url.searchParams.get("region") || "us";
  const userId = url.searchParams.get("userId") || "";

  const country = "us";

  // Get user interests from DB if logged in
  let interests: string[] = [];
  let historyInterests: string[] = [];

  if (userId) {
    try {
      const sb = getSupabaseAdmin();
      if (sb) {
        const [userRes, catsRes] = await Promise.allSettled([
          sb.from("users").select("interests").eq("id", userId).single(),
          sb
            .from("analyses")
            .select("show_category")
            .eq("user_id", userId)
            .not("show_category", "is", null)
            .limit(20),
        ]);

        if (userRes.status === "fulfilled") {
          interests = (userRes.value.data as any)?.interests || [];
        }
        if (catsRes.status === "fulfilled") {
          const catCounts: Record<string, number> = {};
          ((catsRes.value.data as any[]) || []).forEach((a: any) => {
            if (a.show_category)
              catCounts[a.show_category] = (catCounts[a.show_category] || 0) + 1;
          });
          historyInterests = Object.entries(catCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([k]) => k.toLowerCase());
        }
      }
    } catch {}
  }

  // History interests take priority over signup interests
  const activeInterests =
    historyInterests.length > 0 ? historyInterests : interests.map((s) => s.toLowerCase());

  // Build fetch requests
  const requests: [string, Promise<ShowItem[]>][] = [["trending", fetchTop(country)]];

  for (const cat of activeInterests.slice(0, 3)) {
    const genreId = GENRE_MAP[cat];
    if (genreId) {
      requests.push([cat, fetchByGenre(country, genreId)]);
    }
  }

  const results = await Promise.allSettled(requests.map(([, p]) => p));

  // Deduplicate across sections
  const seenIds = new Set<string>();
  const dedup = (arr: ShowItem[]) =>
    arr.filter((item) => {
      if (!item.id || seenIds.has(item.id)) return false;
      seenIds.add(item.id);
      return true;
    });

  const sections: Record<string, ShowItem[]> = {};
  requests.forEach(([label], i) => {
    const res = results[i];
    sections[label] = dedup(res.status === "fulfilled" ? res.value : []).slice(0, 6);
  });

  return new Response(
    JSON.stringify({
      sections,
      interests: activeInterests,
      country,
      personalized: activeInterests.length > 0,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};

export const config: Config = { path: "/api/for-you" };
