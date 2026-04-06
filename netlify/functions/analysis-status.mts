import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { sbUpdate } from "./lib/supabase.js";

/**
 * analysis-status — polling endpoint for analysis progress.
 * Frontend calls /api/analysis-status?job_id=X&plan=Y instead of /api/status/:jobId.
 *
 * Fast path: returns immediately from blob cache for complete/error jobs.
 * Slow path: proxies to /api/status/:jobId (timeout=26s) to trigger Claude processing.
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
    let cached: any = null;
    try {
      cached = await store.get(jobId, { type: "json" });
    } catch {
      // Blob read failure is non-fatal — proceed to status proxy
    }

    // Return immediately from cache if in final state (avoids Claude call)
    if (cached?.status === "complete" || cached?.status === "error") {
      return new Response(JSON.stringify(cached), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Still in progress — call /api/status/:jobId to run Claude if transcript is ready.
    // Use request origin so this always targets the same deploy (preview or prod).
    const origin = new URL(req.url).origin;
    const statusRes = await fetch(
      `${origin}/api/status/${encodeURIComponent(jobId)}?plan=${encodeURIComponent(userPlan)}`,
      { signal: AbortSignal.timeout(24000) }
    );

    // Guard: detect HTML error pages before JSON.parse
    const ct = statusRes.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      const preview = await statusRes.text().then((t) => t.slice(0, 100));
      console.error(`analysis-status: /api/status returned non-JSON (${statusRes.status}): ${preview}`);
      // Return the cached blob state rather than propagating the error
      if (cached) {
        return new Response(JSON.stringify(cached), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ status: "error", error: "Status service unavailable. Please try again." }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

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
    const isTimeout = e?.name === "TimeoutError" || e?.name === "AbortError";
    console.error("analysis-status error:", e?.name, e?.message);
    return new Response(
      JSON.stringify({
        status: "error",
        error: isTimeout
          ? "Analysis is taking longer than expected. Please try again."
          : e?.message || "Unknown error",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config: Config = { path: "/api/analysis-status" };
