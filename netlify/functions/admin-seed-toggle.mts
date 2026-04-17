import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// Admin-only: toggle auto pre-analysis on/off
// GET → returns current state
// POST { paused: true/false } → sets state

export default async (req: Request) => {
  const metaStore = getStore("podlens-meta");
  const KEY = "seed-auto-paused";

  if (req.method === "GET") {
    try {
      const flag = await metaStore.get(KEY, { type: "json" }) as any;
      return new Response(JSON.stringify({ paused: flag?.paused || false }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      return new Response(JSON.stringify({ paused: false }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // POST — toggle
  try {
    const body = await req.json() as any;
    const paused = !!body.paused;
    await metaStore.setJSON(KEY, { paused, updatedAt: new Date().toISOString() });
    return new Response(JSON.stringify({ paused, ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/admin-seed-toggle" };
