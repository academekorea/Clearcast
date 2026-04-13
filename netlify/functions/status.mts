import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { createClient } from "@supabase/supabase-js";

const ANALYSIS_PROMPT = `You are a media literacy expert analyzing a podcast transcript across six intelligence dimensions.

Analyze the transcript and return a JSON object with this EXACT structure — no extra keys, no markdown:
{
  "biasScore": <number -100 (far left) to +100 (far right)>,
  "biasLabel": <"Far left" | "Lean left" | "Center" | "Lean right" | "Far right">,
  "factualityLabel": <"Mostly factual" | "Mixed factuality" | "Unreliable">,
  "omissionRisk": <"Low" | "Med" | "High">,
  "summary": <2-3 sentence plain English summary of the episode and how it leans>,
  "biasReason": <1-2 sentences on specific language/framing choices that drove the score>,
  "dimensions": {
    "perspectiveBalance": {
      "score": <0 to 100, where 100 = all perspectives fairly represented>,
      "label": <"Strong" | "Moderate" | "Weak">,
      "note": <1 sentence: how balanced were the perspectives presented>
    },
    "factualDensity": {
      "score": <0 to 100, where 100 = every claim sourced>,
      "label": <"High" | "Medium" | "Low">,
      "note": <1 sentence: estimated ratio of sourced vs unsourced claims>
    },
    "sourceDiversity": {
      "score": <0 to 100, where 100 = many distinct perspectives>,
      "label": <"High" | "Medium" | "Low">,
      "note": <1 sentence: how many distinct viewpoints or sources were cited>
    },
    "framingPatterns": {
      "score": <0 to 100, where 100 = heavy loaded language>,
      "label": <"Heavy" | "Moderate" | "Neutral">,
      "note": <1 sentence: specific loaded words or rhetorical patterns found>
    },
    "hostCredibility": {
      "score": <0 to 100, where 100 = highly credible — cites sources, corrects errors>,
      "label": <"High" | "Medium" | "Low">,
      "note": <1 sentence: evidence of citation quality or lack of corrections>
    },
    "omissionRisk": {
      "score": <0 to 100, where 100 = high risk — major angles missing>,
      "label": <"High" | "Medium" | "Low">,
      "note": <1 sentence: what important perspective or fact was absent vs comparable coverage>
    }
  },
  "guest": {
    "name": <full name of the main guest, or null>,
    "title": <job title e.g. "CEO", or null>,
    "organization": <company/org e.g. "NVIDIA", or null>,
    "lean": <perceived lean in 3-4 words e.g. "Tech-optimist lean", or null>,
    "episodeCount": <estimated appearances on this show as string e.g. "3", or null>,
    "twitter": <Twitter/X handle without @, or null>,
    "website": <official website URL, or null>
  },
  "highlights": [
    {
      "timestamp": <timestamp string e.g. "12:04" or "1:14:08">,
      "quote": <exact verbatim quote from transcript, under 40 words>,
      "lean": <"left" | "right" | "neutral">,
      "tag": <"Left-leaning" | "Right-leaning" | "Unverified claim" | "Disputed claim" | "Context" | "Sponsor">,
      "reason": <1 sentence explaining why this quote matters>
    }
  ],
  "flags": [
    {
      "type": <"fact-check" | "framing" | "omission" | "sponsor-note" | "context">,
      "title": <short description under 15 words>,
      "detail": <1-2 sentences grounded in verifiable fact>
    }
  ]
}

Rules:
- highlights: 8-12 quotes. Always include both left-leaning AND right-leaning quotes if they exist.
- biasReason: plain English, no jargon
- dimensions: score every dimension — never null
- Only flag things you are highly confident about. Every fact-check must be verifiable.
- Maximum 6 flags
- guest fields: null if unsure
- Return ONLY valid JSON, nothing else`;

// ── SMART TRANSCRIPT SAMPLING ─────────────────────────────────────────────────
// For long episodes, sample beginning + middle + end instead of just truncating.
// Captures intro framing, main argument, and conclusion — all bias-relevant.
function sampleTranscript(text: string, targetWords = 9000): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= targetWords) return text;

  const third = Math.floor(targetWords / 3);
  const start = words.slice(0, third).join(" ");
  const midStart = Math.floor(words.length / 2) - Math.floor(third / 2);
  const middle = words.slice(midStart, midStart + third).join(" ");
  const end = words.slice(-third).join(" ");

  return `${start}\n\n[...middle section...]\n\n${middle}\n\n[...final section...]\n\n${end}`;
}

// ── UPDATE COMMUNITY CATALOG ───────────────────────────────────────────────────
async function updateCatalog(store: any, entry: { jobId: string; showName: string; episodeTitle: string; biasScore: number; biasLabel: string; canonicalKey: string; url: string }) {
  try {
    const catalogKey = "catalog:recent";
    let catalog: any[] = [];
    try {
      const existing = await store.get(catalogKey, { type: "json" }) as any;
      catalog = Array.isArray(existing) ? existing : [];
    } catch {}

    // Remove any existing entry for same canonical key
    catalog = catalog.filter((e: any) => e.canonicalKey !== entry.canonicalKey);

    // Add new entry at front
    catalog.unshift({
      ...entry,
      analyzedAt: Date.now(),
    });

    // Keep last 500
    catalog = catalog.slice(0, 500);
    await store.setJSON(catalogKey, catalog);
  } catch { /* non-critical */ }
}

// ── Supabase write helper — upserts analysis row, handles FK violations ───────
async function writeAnalysisToSupabase(jobId: string, job: any, result: any): Promise<boolean> {
  const supabaseUrl = Netlify.env.get("SUPABASE_URL");
  const supabaseKey = Netlify.env.get("SUPABASE_SERVICE_KEY");
  if (!supabaseUrl || !supabaseKey) return false;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    const dim = result.dimensions || {};
    const canonKey = job.canonicalKey || result.canonicalKey || jobId;
    const analysisRow = {
      job_id:               jobId,
      canonical_key:        canonKey,
      url:                  job.url || result.url || "",
      episode_title:        result.episodeTitle,
      show_name:            result.showName,
      bias_score:           result.biasScore,
      bias_label:           result.biasLabel,
      factuality_label:     result.factualityLabel || null,
      omission_risk:        result.omissionRisk || null,
      summary:              result.summary || null,
      bias_reason:          result.biasReason || null,
      dim_perspective_balance: dim.perspectiveBalance?.score ?? null,
      dim_factual_density:  dim.factualDensity?.score  ?? null,
      dim_source_diversity: dim.sourceDiversity?.score ?? null,
      dim_framing_patterns: dim.framingPatterns?.score ?? null,
      dim_host_credibility: dim.hostCredibility?.score ?? null,
      dim_omission_risk:    dim.omissionRisk?.score    ?? null,
      host_trust_score:     dim.hostCredibility?.score ?? null,
      // Bias percentage breakdown (for share cards + CSV export)
      bias_left_pct:        result.leftPct ?? (result.biasScore != null ? Math.round(Math.max(0, -(result.biasScore)) * 0.5 + 20) : null),
      bias_center_pct:      result.centerPct ?? (result.biasScore != null ? Math.max(5, 100 - Math.round(Math.max(0, -(result.biasScore)) * 0.5 + 20) - Math.round(Math.max(0, result.biasScore) * 0.5 + 20)) : null),
      bias_right_pct:       result.rightPct ?? (result.biasScore != null ? Math.round(Math.max(0, result.biasScore) * 0.5 + 20) : null),
      analyzed_at:          new Date().toISOString(),
      user_id:              job.userId || null,
    };

    // Check if row already exists (canonical_key unique index may be missing)
    const { data: existing } = await supabase
      .from("analyses")
      .select("id")
      .eq("canonical_key", canonKey)
      .maybeSingle();

    let writeErr: any = null;
    if (existing) {
      // Update existing row
      const { error } = await supabase
        .from("analyses")
        .update(analysisRow)
        .eq("canonical_key", canonKey);
      writeErr = error;
    } else {
      // Insert new row
      let { error } = await supabase.from("analyses").insert(analysisRow);
      // FK violation (user_id not in users table) — retry without user_id
      if (error?.code === "23503") {
        console.warn("[status] FK violation on user_id, retrying without user_id");
        const { error: retryErr } = await supabase.from("analyses").insert({ ...analysisRow, user_id: null });
        error = retryErr;
      }
      writeErr = error;
    }
    if (writeErr) {
      console.error("[status] Supabase analyses write error:", writeErr.message, writeErr.details, writeErr.code);
      return false;
    }
    console.log("[status] Supabase analyses write OK:", canonKey);

    // Log the analysis event for per-user data flywheel
    if (job.userId) {
      const { error: eventErr } = await supabase.from("events").insert({
        user_id:    job.userId,
        event_type: "analysis_complete",
        properties: {
          jobId,
          canonicalKey: job.canonicalKey || result.canonicalKey,
          showName: result.showName,
          biasScore: result.biasScore,
          biasLabel: result.biasLabel,
        },
        created_at: new Date().toISOString(),
      });
      if (eventErr) console.error("[status] Supabase events insert error:", eventErr.message, eventErr.code);
    }
    return true;
  } catch (sbErr) {
    console.error("[status] Supabase dual-write failed:", sbErr);
    return false;
  }
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const jobId = url.pathname.split("/").pop();

  if (!jobId) {
    return new Response(JSON.stringify({ error: "Job ID required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const store = getStore("podlens-jobs");
  const job = await store.get(jobId, { type: "json" }) as any;

  if (!job) {
    return new Response(JSON.stringify({ error: "Job not found" }), {
      status: 404, headers: { "Content-Type": "application/json" },
    });
  }

  // Return immediately if already done — but backfill Supabase if missing
  if (job.status === "complete" || job.status === "error") {
    if (job.status === "complete" && job.biasScore !== undefined && !job._sbWritten) {
      // Backfill Supabase for analyses that completed before the fix
      const ok = await writeAnalysisToSupabase(jobId, job, job);
      if (ok) {
        try { await store.setJSON(jobId, { ...job, _sbWritten: true }); } catch {}
      }
    }
    return new Response(JSON.stringify(job), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  // ── Stuck job guard ───────────────────────────────────────────────────────
  // If a job has been pending/transcribing for >20 min, it's stuck — mark as error
  // so the user isn't waiting forever on a Railway or AssemblyAI timeout.
  if (job.pendingTimeoutAt && Date.now() > job.pendingTimeoutAt) {
    const timedOut = {
      ...job,
      status: "error",
      error: "Analysis timed out. This can happen with very long episodes or audio quality issues. Please try again — results for this episode are cached if it was previously analyzed by anyone.",
    };
    await store.setJSON(jobId, timedOut);
    return new Response(JSON.stringify(timedOut), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  let transcriptText: string;
  let audioDuration: number | undefined;
  let transcriptWords: any[] = []; // word-level timestamps for seek (Priority 4)

  if (job.status === "transcribed") {
    transcriptText = job.transcript || "";
    transcriptWords = job.words || [];
    audioDuration = undefined;
  } else {
    // AssemblyAI polling
    const assemblyKey = Netlify.env.get("ASSEMBLYAI_API_KEY");
    if (!assemblyKey) {
      const err = { ...job, status: "error", error: "Transcription service not configured." };
      await store.setJSON(jobId, err);
      return new Response(JSON.stringify(err), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    let aaiJson: any;
    try {
      const aaiRes = await fetch(`https://api.assemblyai.com/v2/transcript/${job.transcriptId}`, {
        headers: { authorization: assemblyKey },
        signal: AbortSignal.timeout(15000),
      });
      aaiJson = await aaiRes.json();
    } catch (fetchErr: any) {
      // Network blip — return transcribing so client retries
      return new Response(JSON.stringify({ status: "transcribing", jobId }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    if (aaiJson.status === "error") {
      const updated = { ...job, status: "error", error: `Transcription failed: ${aaiJson.error || "unknown error"}` };
      await store.setJSON(jobId, updated);
      return new Response(JSON.stringify(updated), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (aaiJson.status !== "completed") {
      return new Response(JSON.stringify({ status: "transcribing", jobId }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    transcriptText = aaiJson.text || "";
    audioDuration = aaiJson.audio_duration;

    // Store word-level timestamps — used by transcript seek (Priority 4)
    // Each word: { text, start, end, confidence } where start/end are milliseconds
    if (Array.isArray(aaiJson.words) && aaiJson.words.length > 0) {
      // Store every 5th word to reduce blob size while keeping seek granularity ~2s
      transcriptWords = aaiJson.words
        .filter((_: any, i: number) => i % 5 === 0)
        .map((w: any) => ({ t: w.text, s: Math.round(w.start / 1000), e: Math.round(w.end / 1000) }));
    }
  }

  if (!transcriptText || transcriptText.trim().length < 100) {
    const updated = { ...job, status: "error", error: "Transcript is too short or empty. The audio may be silent, too short, or not in English." };
    await store.setJSON(jobId, updated);
    return new Response(JSON.stringify(updated), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  // Smart sampling — captures beginning, middle, end of long episodes
  const sampledTranscript = sampleTranscript(transcriptText, 9000);

  // ── Claude analysis with retry + exponential backoff ──────────────────────
  const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");
    let claudeRes: Response | null = null;
  let claudeErr: any = null;
  const delays = [0, 3000, 8000]; // 3 attempts: immediate, 3s, 8s

  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) await new Promise(r => setTimeout(r, delays[attempt]));
    try {
      claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropicKey!,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          messages: [{ role: "user", content: `${ANALYSIS_PROMPT}\n\nTranscript:\n${sampledTranscript}` }],
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (claudeRes.ok) break;
      const errBody = await claudeRes.text().catch(() => "");
      console.error(`[status] Claude HTTP ${claudeRes.status}: ${errBody}`);
      throw new Error(`Claude HTTP ${claudeRes.status}: ${errBody}`);
    } catch (e) {
      claudeErr = e;
      console.error(`[status] Claude attempt ${attempt + 1} failed:`, e);
    }
  }

  if (!claudeRes || !claudeRes.ok) {
    const updated = { ...job, status: "error", error: `Analysis service unavailable: ${claudeErr?.message || "unknown"}` };
    await store.setJSON(jobId, updated);
    return new Response(JSON.stringify(updated), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  const claudeData = await claudeRes.json();
  const rawText = claudeData.content?.[0]?.text || "{}";

  let analysis: any;
  try {
    analysis = JSON.parse(rawText.replace(/```json|```/g, "").trim());
    // Validate it's a real analysis, not a dummy
    if (typeof analysis.biasScore !== "number") throw new Error("Invalid analysis shape");
  } catch {
    const updated = { ...job, status: "error", error: "Analysis could not be parsed. Please try again." };
    await store.setJSON(jobId, updated);
    return new Response(JSON.stringify(updated), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  // ── Compute plain-English bias label from score (CLAUDE.md spec) ────────────
  // Claude returns directional labels ("Lean left") — we override with severity
  // labels that match the spec and are shown to users everywhere.
  function plainBiasLabel(score: number): string {
    const bs = Math.max(-100, Math.min(100, score));
    // Derive left/right percentages using same formula as _biasSegs on frontend
    let lp: number, rp: number;
    if (bs < -5) {
      lp = Math.round(30 + Math.abs(bs) * 0.45);
      rp = Math.max(5, Math.round(20 - Math.abs(bs) * 0.15));
    } else if (bs > 5) {
      rp = Math.round(30 + bs * 0.45);
      lp = Math.max(5, Math.round(20 - bs * 0.15));
    } else { lp = 20; rp = 20; }
    const diff = Math.abs(lp - rp);
    if (diff < 20) return "Mostly balanced";
    if (diff < 40) return "Lightly one-sided";
    if (diff < 60) return "Moderately biased";
    if (diff < 80) return "Heavily one-sided";
    return "Extremely one-sided";
  }

  // Keep Claude's directional label as biasDirection, override biasLabel with spec label
  analysis.biasDirection = analysis.biasLabel || "";
  analysis.biasLabel = plainBiasLabel(analysis.biasScore);

  const result = {
    status: "complete",
    jobId,
    url: job.url,
    canonicalKey: job.canonicalKey,
    episodeTitle: job.episodeTitle || "Podcast Episode",
    showName: job.showName || "",
    duration: audioDuration ? `${Math.round(audioDuration / 60)} min` : "Unknown",
    ...analysis,
    biasLabel:     analysis.biasLabel,      // plain-English severity: "Mostly balanced" etc
    biasDirection: analysis.biasDirection,  // directional: "Lean left" etc
    dimensions: analysis.dimensions || null,
    guest: analysis.guest || null,
    // Word-level timestamps stored compactly for transcript seek
    // Format: [{ t: "word", s: startSecs, e: endSecs }]
    words: transcriptWords.length > 0 ? transcriptWords : undefined,
    analyzeCount: 1,
    firstAnalyzedAt: Date.now(),
    lastRequestedAt: Date.now(),
  };

  // Save job result
  await store.setJSON(jobId, result);

  // ── Community cache: store by canonical key (permanent, no TTL) ──────────
  if (job.canonicalKey) {
    try {
      await store.setJSON(`canon:${job.canonicalKey}`, result);
    } catch {}
  }

  // ── Legacy URL cache (backward compat) ───────────────────────────────────
  if (job.url) {
    const legacyKey = "url-" + Buffer.from(job.url).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 80);
    try { await store.setJSON(legacyKey, { jobId, cachedAt: Date.now(), url: job.url }); } catch {}
  }

  // ── Update community catalog ──────────────────────────────────────────────
  await updateCatalog(store, {
    jobId,
    showName: result.showName,
    episodeTitle: result.episodeTitle,
    biasScore: result.biasScore,
    biasLabel: result.biasLabel,
    canonicalKey: job.canonicalKey || jobId,
    url: job.url,
  });

  // ── Supabase dual-write (data flywheel) ───────────────────────────────────
  // Writes to analyses table for trend charts, echo chamber, fingerprints.
  // Non-blocking — never fails the response if Supabase is down.
  await writeAnalysisToSupabase(jobId, job, result);
  // Mark as written so backfill path doesn't re-run on subsequent polls
  result._sbWritten = true;

  return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config: Config = { path: "/api/status/:jobId", timeout: 300 };
