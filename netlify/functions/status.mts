import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// ── TIER GATING ───────────────────────────────────────────────────────────
function gateForTier(data: any, plan: string): any {
  const p = (plan || "free").toLowerCase();
  const isCreatorPlus = ["creator", "operator", "studio"].includes(p) || p === "trial";
  const isOperatorPlus = ["operator", "studio"].includes(p);

  if (!isCreatorPlus) {
    return {
      ...data,
      audioLean: data.audioLean ? {
        leftPct: null, centerPct: null, rightPct: null,
        basis: null, citations: [],
        _locked: true,
      } : null,
      keyQuotes: [],
      flags: [],
      missingVoices: [],
      sponsorConflicts: [],
      topicBreakdown: (data.topicBreakdown || []).slice(0, 3).map((t: any) => ({
        topic: t.topic, percentage: null, lean: null,
      })),
    };
  }

  if (!isOperatorPlus) {
    return {
      ...data,
      flags: (data.flags || []).map((f: any) => ({ ...f, citations: [] })),
      missingVoices: [],
      sponsorConflicts: [],
    };
  }

  return data;
}

// ── HANDLER — pure blob reader, no Claude calls ───────────────────────────
export default async (req: Request) => {
  const url = new URL(req.url);
  const parts = url.pathname.split("/");
  const jobId = parts[parts.length - 1];
  const userPlan = url.searchParams.get("plan") || "free";

  if (!jobId) {
    return new Response(JSON.stringify({ error: "Job ID required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const store = getStore("podlens-jobs");
    const job = await store.get(jobId, { type: "json" }) as any;

    if (!job) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }

    // Complete or error — return gated result
    if (job.status === "complete" || job.status === "error") {
      return new Response(JSON.stringify(gateForTier(job, userPlan)), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // Partial (Phase 1 done, Phase 2 in progress) — return partial gated result
    if (job.status === "partial") {
      const { _transcript: _t, ...partialForClient } = job;
      return new Response(JSON.stringify(gateForTier(partialForClient, userPlan)), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // Still transcribing or transcribed — worker is running
    return new Response(JSON.stringify({ jobId, status: job.status || "transcribing" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ status: "error", error: e?.message || "Unknown error" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/status/:jobId" };
