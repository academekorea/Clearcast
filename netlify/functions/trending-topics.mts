import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { getSupabaseAdmin } from "./lib/supabase.js";

const CACHE_KEY = "trending-topics-cache";
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function json(data: object, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
  });
}

export default async () => {
  // Check cache first
  try {
    const store = getStore("podlens-cache");
    const cached = await store.get(CACHE_KEY, { type: "json" }) as any;
    if (cached && cached.ts && Date.now() - cached.ts < CACHE_TTL) {
      return json({ topics: cached.topics });
    }
  } catch {}

  const sb = getSupabaseAdmin();
  if (!sb) {
    return json({ topics: [] });
  }

  try {
    // Query last 30 days of analyses
    const recent = await sb
      .from("analyses")
      .select("show_name")
      .gte("analyzed_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    let rows = (recent.data || []) as any[];

    // If fewer than 5 results, fall back to all-time
    if (rows.length < 5) {
      const allTime = await sb.from("analyses").select("show_name");
      rows = (allTime.data || []) as any[];
    }

    // Group by show_name and count
    const counts: Record<string, number> = {};
    for (const row of rows) {
      const name = row.show_name;
      if (name) counts[name] = (counts[name] || 0) + 1;
    }

    const topics = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));

    // Cache result
    try {
      const store = getStore("podlens-cache");
      await store.setJSON(CACHE_KEY, { topics, ts: Date.now() });
    } catch {}

    return json({ topics });
  } catch {
    return json({ topics: [] });
  }
};

export const config: Config = { path: "/api/trending-topics" };
