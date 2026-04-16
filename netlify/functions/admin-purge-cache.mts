import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { isSuperAdmin } from "./lib/admin.js";

// ── Admin-only cache purge ────────────────────────────────────────────────────
// Removes a poisoned community cache entry by canonical key (or jobId). Used
// to clear entries that were written before the analyze.mts fix stopped the
// RSS "latest episode" fallback from transcribing the wrong audio.
//
// Usage:
//   POST /api/admin-purge-cache
//   { "email": "academekorea@gmail.com", "canonicalKey": "yt:Hrbq66XqtCo" }
//     → deletes canon:yt:Hrbq66XqtCo and any jobIds pinned to that key
//
// Auth: email must be a super admin (checked via lib/admin.ts allowlist).

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const email: string = (body.email || "").trim();
  if (!isSuperAdmin(email)) {
    console.warn("[admin-purge-cache] unauthorized attempt, email=", email);
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  const canonicalKey: string = (body.canonicalKey || "").trim();
  const jobId: string = (body.jobId || "").trim();

  if (!canonicalKey && !jobId) {
    return new Response(JSON.stringify({ error: "canonicalKey or jobId required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const store = getStore("podlens-jobs");
  const deleted: string[] = [];
  const errors: Record<string, string> = {};

  // Invalidate canon:{key} by overwriting with a non-"complete" status marker.
  // Using store.delete() didn't stick — concurrent analyze() calls during the
  // eventual-consistency window would resurrect the blob (the cache-hit path
  // re-writes canon to increment analyzeCount). setJSON is strongly consistent,
  // and analyze.mts's cache check skips any blob where status !== "complete",
  // so the next user request triggers a fresh analysis and status.mts line 520
  // overwrites canon with the correct result.
  if (canonicalKey) {
    const canonKey = `canon:${canonicalKey}`;
    try {
      const cached = await store.get(canonKey, { type: "json" }) as any;
      const pinnedJobId = cached?.jobId || null;
      await store.setJSON(canonKey, {
        status: "error",
        error: "Cache invalidated by admin — a fresh analysis will overwrite this on next request.",
        invalidatedAt: new Date().toISOString(),
        invalidatedBy: email,
      });
      deleted.push(canonKey);
      // Also invalidate the pinned jobId so status polls don't serve the stale
      // result either. Same approach: overwrite with status=error.
      if (pinnedJobId && typeof pinnedJobId === "string") {
        try {
          await store.setJSON(pinnedJobId, {
            status: "error",
            jobId: pinnedJobId,
            error: "This analysis was invalidated — please re-run analyze for a fresh result.",
            invalidatedAt: new Date().toISOString(),
            invalidatedBy: email,
          });
          deleted.push(pinnedJobId);
        } catch (e: any) { errors[pinnedJobId] = e?.message || "invalidate failed"; }
      }
    } catch (e: any) { errors[canonKey] = e?.message || "invalidate failed"; }
  }

  // Also delete a specific jobId if provided (covers broken job blobs that
  // 502 on status reads, e.g. corrupted JSON from mid-processing crashes).
  if (jobId) {
    try {
      await store.delete(jobId);
      deleted.push(jobId);
    } catch (e: any) { errors[jobId] = e?.message || "delete failed"; }
  }

  console.log("[admin-purge-cache] admin=", email, "deleted=", deleted, "errors=", errors);

  return new Response(JSON.stringify({ ok: true, deleted, errors }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = { path: "/api/admin-purge-cache" };
