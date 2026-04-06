import type { Config } from "@netlify/functions";
import { sbInsert } from "./lib/supabase.js";

/**
 * start-analysis — thin wrapper around /api/analyze that records job to Supabase analysis_queue.
 * Frontend calls this instead of /api/analyze directly.
 * Same request/response contract as /api/analyze.
 */
export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json();
    const { url, userId } = body;

    // Record job to Supabase analysis_queue (fire-and-forget, non-blocking)
    if (url) {
      sbInsert("analysis_queue", {
        user_id: userId || null,
        episode_url: url,
        status: "queued",
        queued_at: new Date().toISOString(),
      }).catch(() => {});
    }

    // Forward to analyze function
    const siteUrl = Netlify.env.get("URL") || "https://podlens.netlify.app";
    const analyzeRes = await fetch(`${siteUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await analyzeRes.json();
    return new Response(JSON.stringify(data), {
      status: analyzeRes.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("start-analysis error:", e);
    return new Response(JSON.stringify({ error: e?.message || "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/start-analysis" };
