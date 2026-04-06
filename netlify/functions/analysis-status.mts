import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { sbUpdate } from "./lib/supabase.js";

/**
 * analysis-status — polling endpoint for analysis progress.
 * Frontend calls /api/analysis-status?job_id=X&plan=Y instead of /api/status/:jobId.
 *
 * Reads blob cache first. If job is already complete/error, returns immediately
 * without hitting Claude. Otherwise proxies to /api/status/:jobId (which has
 * timeout = 26s configured in netlify.toml) to trigger the Claude processing,
 * then updates Supabase analysis_queue progress.
 */
export default async (req: Request) => {
  const url = new URL(req.url);
  const jobId = url.searchParams.get("job_id");
  const userPlan = url.searchParams.get("plan") || "free";

  if (!jobId) {
    return new Response(JSON.stringify({ error: "job_id required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Fast path: check blob cache for completed/errored jobs
    const store = getStore("podlens-jobs");
    const cached = await store.get(jobId, { type: "json" }) as any;

    if (!cached) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Return immediately from cache if final state (no Claude call needed)
    if (cached.status === "complete" || cached.status === "error") {
      return new Response(JSON.stringify(cached), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Still in progress — proxy to /api/status/:jobId which runs Claude
    const siteUrl = Netlify.env.get("URL") || "https://podlens.netlify.app";
    const statusRes = await fetch(
      `${siteUrl}/api/status/${encodeURIComponent(jobId)}?plan=${encodeURIComponent(userPlan)}`,
      { signal: AbortSignal.timeout(25000) }
    );
    const data = await statusRes.json();

    // Update Supabase analysis_queue progress (fire-and-forget)
    if (data.url) {
      if (data.status === "complete") {
        sbUpdate(
          "analysis_queue",
          { episode_url: data.url },
          { status: "complete", progress: 100, completed_at: new Date().toISOString() }
        ).catch(() => {});
      } else if (data.status === "partial") {
        sbUpdate(
          "analysis_queue",
          { episode_url: data.url },
          { status: "partial", progress: 50 }
        ).catch(() => {});
      } else if (data.status === "transcribing") {
        sbUpdate(
          "analysis_queue",
          { episode_url: data.url },
          { status: "processing", progress: 20 }
        ).catch(() => {});
      }
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("analysis-status error:", e);
    return new Response(
      JSON.stringify({ status: "error", error: e?.message || "Unknown error" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config: Config = { path: "/api/analysis-status" };
