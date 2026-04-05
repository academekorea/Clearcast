import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export default async (req: Request) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const store = getStore("podlens-cache");
  const key = "platform-stats";

  const json = (data: object) =>
    new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });

  if (req.method === "POST" && action === "increment") {
    try {
      const existing = (await store.get(key, { type: "json" }).catch(() => null)) as any || {};
      const now = Date.now();
      // Reset weekly counter on Monday
      const weekStart = existing.weekStart || 0;
      const msInWeek = 7 * 24 * 60 * 60 * 1000;
      const isNewWeek = now - weekStart > msInWeek;
      const updated = {
        totalAnalyses: (existing.totalAnalyses || 0) + 1,
        analysesThisWeek: isNewWeek ? 1 : (existing.analysesThisWeek || 0) + 1,
        weekStart: isNewWeek ? now : (existing.weekStart || now),
        lastUpdated: now,
      };
      await store.setJSON(key, updated);
      return json(updated);
    } catch {
      return json({ error: "Failed to increment" });
    }
  }

  // GET — return stats
  try {
    const stats = (await store.get(key, { type: "json" }).catch(() => null)) as any;
    if (!stats) return json({ totalAnalyses: 0, analysesThisWeek: 0, lastUpdated: 0 });
    return json(stats);
  } catch {
    return json({ totalAnalyses: 0, analysesThisWeek: 0, lastUpdated: 0 });
  }
};

export const config: Config = { path: "/api/platform-stats" };
