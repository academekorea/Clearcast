import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Tier gating for Unheard:
//   free/trial  → locked: true, no stories
//   creator     → 1 full story + 4 locked headlines
//   operator/studio → all 5 stories

function getWeekNumber(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${week}`;
}

export default async (req: Request) => {
  const plan = (req.headers.get("x-pl-plan") || "").toLowerCase().trim();
  const userId = req.headers.get("x-pl-user") || "";

  // Free and trial: fully locked
  if (!plan || plan === "free") {
    return new Response(JSON.stringify({ locked: true, stories: [], preview: null, tier: "free" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  const isCreator = plan === "creator";
  const isOperatorPlus = plan === "operator" || plan === "studio";
  const isTrial = plan === "trial";

  // Trial gets locked too (trial blocks Unheard per CLAUDE.md)
  if (isTrial) {
    return new Response(JSON.stringify({ locked: true, stories: [], preview: null, tier: "trial" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  const week = getWeekNumber();

  // Check per-user weekly cache for Creator tier
  if (isCreator && userId) {
    try {
      const userStore = getStore("podlens-users");
      const cached = await userStore.get(`unheard-${userId}-week-${week}`, { type: "json" }) as any;
      if (cached?.stories) {
        // Return only 1 full story + 4 locked headlines
        return new Response(JSON.stringify(buildCreatorResponse(cached.stories)), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
    } catch {}
  }

  // Build stories from analysis data
  try {
    const jobStore = getStore("podlens-jobs");
    const keys = await jobStore.list();
    const blobs = (keys.blobs || []).slice(0, 100);

    const leftShows: any[] = [];
    const rightShows: any[] = [];

    for (const key of blobs) {
      try {
        const job = await jobStore.get(key.key, { type: "json" }) as any;
        if (!job || job.status !== "complete") continue;
        const lean = job.audioLean || {};
        const leftPct = lean.leftPct || 0;
        const rightPct = lean.rightPct || 0;
        const diff = Math.abs(leftPct - rightPct);
        if (diff < 30) continue; // Only notably one-sided episodes

        const story = {
          id: key.key,
          episodeTitle: job.episodeTitle || "Untitled Episode",
          showName: job.showName || "",
          artwork: job.artworkUrl || "",
          biasLabel: leftPct > rightPct ? "left-leaning" : "right-leaning",
          leftPct,
          rightPct,
          summary: job.summary || "",
          topFindings: (job.findings || []).slice(0, 2).map((f: any) => f.title || ""),
          analyzedAt: job.completedAt || job.startedAt || "",
        };

        if (leftPct > rightPct) leftShows.push(story);
        else rightShows.push(story);
      } catch {}
    }

    // Mix left and right for variety — max 5 total stories
    const allStories: any[] = [];
    const maxEach = 3;
    leftShows.slice(0, maxEach).forEach(s => allStories.push(s));
    rightShows.slice(0, maxEach).forEach(s => allStories.push(s));
    allStories.sort((a, b) => Math.abs(b.leftPct - b.rightPct) - Math.abs(a.leftPct - a.rightPct));
    const stories = allStories.slice(0, 5);

    // Cache for creator weekly limit
    if (isCreator && userId && stories.length > 0) {
      try {
        const userStore = getStore("podlens-users");
        await userStore.setJSON(`unheard-${userId}-week-${week}`, { stories, cachedAt: new Date().toISOString() });
      } catch {}
    }

    if (isCreator) {
      return new Response(JSON.stringify(buildCreatorResponse(stories)), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // Operator / Studio: all stories
    return new Response(JSON.stringify({
      locked: false,
      stories,
      tier: plan,
      totalCount: stories.length,
      remaining: 0,
      week,
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch {
    return new Response(JSON.stringify({ locked: false, stories: [], tier: plan, totalCount: 0 }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
};

function buildCreatorResponse(stories: any[]) {
  const full = stories.slice(0, 1);
  const locked = stories.slice(1, 5).map((s: any) => ({
    episodeTitle: s.episodeTitle,
    showName: s.showName,
    biasLabel: s.biasLabel,
    locked: true,
  }));
  return {
    locked: false,
    stories: full,
    lockedPreviews: locked,
    tier: "creator",
    totalCount: stories.length,
    remaining: locked.length,
    seenOf: `1 of ${stories.length}`,
  };
}

export const config: Config = { path: "/api/blindspot" };
