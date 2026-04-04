import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const PRO_PLANS = new Set(["operator", "studio", "trial"]);

export default async (req: Request) => {
  // Gate: only Pro plans (Operator / Studio) may receive Unheard data.
  // The client sends the user's plan in the x-pl-plan header.
  // This is a best-effort server gate — the real guarantee is the
  // client never calling this endpoint for non-Pro users.
  const plan = (req.headers.get("x-pl-plan") || "").toLowerCase().trim();
  if (!PRO_PLANS.has(plan)) {
    return new Response(JSON.stringify({ locked: true, preview: null }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const store = getStore("podlens-jobs");
    const keys = await store.list();

    const leftShows: string[] = [];
    const rightShows: string[] = [];
    const leftTopics: Record<string, number> = {};
    const rightTopics: Record<string, number> = {};

    for (const key of (keys.blobs || []).slice(0, 50)) {
      try {
        const job = await store.get(key.key, { type: "json" }) as any;
        if (!job || job.status !== "complete") continue;
        const score = job.biasScore ?? 0;
        const title = job.episodeTitle || "";
        if (score < -20) {
          leftShows.push(title);
          (job.flags || []).forEach((f: any) => {
            if (f.title) leftTopics[f.title] = (leftTopics[f.title] || 0) + 1;
          });
        } else if (score > 20) {
          rightShows.push(title);
          (job.flags || []).forEach((f: any) => {
            if (f.title) rightTopics[f.title] = (rightTopics[f.title] || 0) + 1;
          });
        }
      } catch {}
    }

    // Top topics per side
    const topLeft = Object.entries(leftTopics).sort((a,b) => b[1]-a[1]).slice(0,5).map(([t]) => t);
    const topRight = Object.entries(rightTopics).sort((a,b) => b[1]-a[1]).slice(0,5).map(([t]) => t);

    return new Response(JSON.stringify({
      totalAnalyzed: (keys.blobs || []).length,
      leftLeaning: { count: leftShows.length, topFlags: topLeft },
      rightLeaning: { count: rightShows.length, topFlags: topRight },
      lastUpdated: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch {
    return new Response(JSON.stringify({ totalAnalyzed: 0, leftLeaning: { count: 0, topFlags: [] }, rightLeaning: { count: 0, topFlags: [] } }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/blindspot" };
