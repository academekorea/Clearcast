import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

/**
 * analysis-status — simple polling endpoint.
 * Frontend polls GET /api/analysis-status?job_id=X&plan=Y
 * Returns current status from blob. No internal HTTP calls.
 */
export default async (req: Request) => {
  const url = new URL(req.url);
  const jobId = url.searchParams.get("job_id");
  const userPlan = url.searchParams.get("plan") || "free";

  if (!jobId) {
    return new Response(JSON.stringify({ error: "job_id required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const store = getStore("podlens-jobs");
    const job = await store.get(jobId, { type: "json" }) as any;

    if (!job) {
      return new Response(JSON.stringify({ error: "Job not found", status: "error" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    const p = (userPlan || "free").toLowerCase();
    const isCreatorPlus = ["creator", "operator", "studio", "trial"].includes(p);
    const isOperatorPlus = ["operator", "studio"].includes(p);

    // Complete — return full gated result with analysis_id for redirect
    if (job.status === "complete") {
      let result = { ...job, analysis_id: jobId };
      if (!isCreatorPlus) {
        result = {
          ...result,
          audioLean: result.audioLean ? { leftPct: null, centerPct: null, rightPct: null, basis: null, citations: [], _locked: true } : null,
          keyQuotes: [], flags: [], missingVoices: [], sponsorConflicts: [],
          topicBreakdown: (result.topicBreakdown || []).slice(0, 3).map((t: any) => ({ topic: t.topic, percentage: null, lean: null })),
        };
      } else if (!isOperatorPlus) {
        result = {
          ...result,
          flags: (result.flags || []).map((f: any) => ({ ...f, citations: [] })),
          missingVoices: [], sponsorConflicts: [],
        };
      }
      const { _transcript: _t, ...clean } = result;
      return new Response(JSON.stringify(clean), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // Error
    if (job.status === "error") {
      return new Response(JSON.stringify({ status: "error", error: job.error || "Analysis failed" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // Partial (Phase 1 done, Phase 2 running)
    if (job.status === "partial") {
      let result: any = { ...job, analysis_id: jobId };
      if (!isCreatorPlus) {
        result = {
          ...result,
          audioLean: result.audioLean ? { leftPct: null, centerPct: null, rightPct: null, basis: null, citations: [], _locked: true } : null,
          keyQuotes: [], flags: [], missingVoices: [], sponsorConflicts: [],
          topicBreakdown: (result.topicBreakdown || []).slice(0, 3).map((t: any) => ({ topic: t.topic, percentage: null, lean: null })),
        };
      }
      const { _transcript: _t, ...clean } = result;
      return new Response(JSON.stringify(clean), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // Still transcribing / transcribed — worker is running
    return new Response(JSON.stringify({ status: job.status || "transcribing", jobId }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ status: "error", error: e?.message || "Unknown error" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/analysis-status" };
