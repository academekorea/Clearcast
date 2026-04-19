import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { createClient } from "@supabase/supabase-js";

// One-time migration: scan Netlify Blobs for completed analyses
// and write them to Supabase analyses table.
// Triggered manually via POST /api/backfill-analyses with admin auth.

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const json = (data: object, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  // Simple auth check — super admin only
  try {
    const body = await req.json();
    if (body.secret !== Netlify.env.get("ADMIN_SECRET") && body.email !== "academekorea@gmail.com") {
      return json({ error: "Unauthorized" }, 403);
    }
  } catch {
    return json({ error: "Invalid body" }, 400);
  }

  const supabaseUrl = Netlify.env.get("SUPABASE_URL");
  const supabaseKey = Netlify.env.get("SUPABASE_SERVICE_KEY");
  if (!supabaseUrl || !supabaseKey) return json({ error: "Supabase not configured" }, 503);

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const store = getStore("podlens-jobs");

  let migrated = 0;
  let skipped = 0;
  let errors: string[] = [];

  try {
    // List all blobs in the podlens-jobs store
    const { blobs } = await store.list();

    const MAX_PROCESS = 50; // Process in batches to avoid timeout
    let processed = 0;

    for (const blob of blobs) {
      if (processed >= MAX_PROCESS) break;
      const key = blob.key;
      // Skip non-job entries (canon:, brief:, etc.)
      if (key.startsWith("canon:") || key.startsWith("brief:") || key.startsWith("legacy:")) {
        continue;
      }
      processed++;

      try {
        const job = await store.get(key, { type: "json" }) as any;
        if (!job) continue;

        // Only migrate completed analyses with bias scores
        if (job.status !== "complete" || job.biasScore === undefined) {
          skipped++;
          continue;
        }

        // Skip if already written
        if (job._sbWritten) {
          skipped++;
          continue;
        }

        const dim = job.dimensions || {};
        const canonKey = job.canonicalKey || key;

        // Check if already in Supabase
        const { data: existing } = await supabase
          .from("analyses")
          .select("id")
          .eq("job_id", key)
          .maybeSingle();

        if (existing) {
          // Mark as written in blob store
          try { await store.setJSON(key, { ...job, _sbWritten: true }); } catch {}
          skipped++;
          continue;
        }

        const analysisRow = {
          job_id: key,
          canonical_key: canonKey,
          share_id: crypto.randomUUID(),
          url: job.url || "",
          episode_title: job.episodeTitle || null,
          show_name: job.showName || null,
          bias_score: job.biasScore,
          bias_label: job.biasLabel || null,
          bias_direction: job.biasDirection || job.biasLabel || null,
          factuality_label: job.factualityLabel || null,
          summary: job.summary || null,
          dim_perspective_balance: dim.perspectiveBalance?.score ?? null,
          dim_factual_density: dim.factualDensity?.score ?? null,
          dim_source_diversity: dim.sourceDiversity?.score ?? null,
          dim_framing_patterns: dim.framingPatterns?.score ?? null,
          dim_host_credibility: dim.hostCredibility?.score ?? null,
          dim_omission_risk: dim.omissionRisk?.score ?? null,
          host_trust_score: dim.hostCredibility?.score ?? null,
          host_count: job.hostCount ?? null,
          has_guest: job.hasGuest ?? null,
          guest_score: job.guestScore ?? null,
          duration_minutes: job.durationMinutes || null,
          episode_number: job.episodeNumber || null,
          host_names: job.hostNames || null,
          bias_left_pct: job.leftPct ?? null,
          bias_center_pct: job.centerPct ?? null,
          bias_right_pct: job.rightPct ?? null,
          analyzed_at: job.analyzedAt || job.completedAt || new Date().toISOString(),
          user_id: job.userId || null,
          show_category: job.showCategory || null,
        };

        let { error } = await supabase.from("analyses").insert(analysisRow);
        // FK violation — retry without user_id
        if (error?.code === "23503") {
          const { error: retryErr } = await supabase.from("analyses").insert({ ...analysisRow, user_id: null });
          error = retryErr;
        }

        if (error) {
          errors.push(`${key}: ${error.message}`);
        } else {
          migrated++;
          // Mark as written
          try { await store.setJSON(key, { ...job, _sbWritten: true }); } catch {}
        }
      } catch (e: any) {
        errors.push(`${key}: ${e.message}`);
      }
    }

    return json({
      migrated,
      skipped,
      processed,
      totalBlobs: blobs.length,
      hasMore: processed >= MAX_PROCESS,
      errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
    });
  } catch (err: any) {
    return json({ error: err.message || "Migration failed" }, 500);
  }
};

export const config: Config = { path: "/api/backfill-analyses" };
