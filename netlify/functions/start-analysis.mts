import type { Config } from "@netlify/functions";
import { sbInsert } from "./lib/supabase.js";

/**
 * start-analysis — wrapper around /api/analyze that records the job to Supabase analysis_queue.
 * Frontend calls this instead of /api/analyze directly.
 * Same request/response contract as /api/analyze.
 */
export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

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

  try {
    // Use request origin so this always hits the same deploy (preview or prod)
    const origin = new URL(req.url).origin;
    const analyzeRes = await fetch(`${origin}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(28000),
    });

    // Guard: detect HTML error pages before trying to parse JSON
    const ct = analyzeRes.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      const preview = await analyzeRes.text().then((t) => t.slice(0, 100));
      console.error(`start-analysis: /api/analyze returned non-JSON (${analyzeRes.status}): ${preview}`);
      return new Response(
        JSON.stringify({ error: "Analysis service unavailable. Please try again." }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = await analyzeRes.json();
    return new Response(JSON.stringify(data), {
      status: analyzeRes.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const isTimeout = e?.name === "TimeoutError" || e?.name === "AbortError";
    console.error("start-analysis error:", e?.name, e?.message);
    return new Response(
      JSON.stringify({
        error: isTimeout
          ? "Analysis service timed out. Please try again."
          : e?.message || "Server error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config: Config = { path: "/api/start-analysis" };
