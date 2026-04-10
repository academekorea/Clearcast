import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const ANALYSIS_PROMPT = `You are a media literacy expert analyzing a podcast transcript for bias, factual accuracy, and framing patterns.

Analyze the transcript and return a JSON object with this exact structure:
{
  "biasScore": <number from -100 (far left) to +100 (far right)>,
  "biasLabel": <"Far left" | "Lean left" | "Center" | "Lean right" | "Far right">,
  "factualityLabel": <"Mostly factual" | "Mixed factuality" | "Unreliable">,
  "omissionRisk": <"Low" | "Med" | "High">,
  "summary": <2-3 sentence plain English summary of what this episode is about and how it leans>,
  "biasReason": <1-2 sentences explaining exactly what language patterns drove the bias score — be specific about framing choices>,
  "guest": {
    "name": <full name of the main guest, or null if no clear guest>,
    "title": <their job title e.g. "CEO" or "Senator", or null>,
    "organization": <their company/org e.g. "NVIDIA" or "US Senate", or null>,
    "lean": <their perceived political/ideological lean in 3-4 words e.g. "Tech-optimist lean" or "Progressive lean", or null>,
    "episodeCount": <estimated number of times this person has appeared on this show as a string e.g. "3", or null>,
    "twitter": <their Twitter/X handle without @, or null>,
    "website": <their official website URL, or null>
  },
  "highlights": [
    {
      "timestamp": <timestamp string e.g. "12:04" or "1:14:08">,
      "quote": <exact verbatim quote from the transcript, under 40 words>,
      "lean": <"left" | "right" | "neutral">,
      "tag": <"Left-leaning" | "Right-leaning" | "Unverified claim" | "Disputed claim" | "Context" | "Sponsor">,
      "reason": <1 sentence explaining why this quote leans the way it does, or what makes it notable>
    }
  ],
  "flags": [
    {
      "type": <"fact-check" | "framing" | "omission" | "sponsor-note" | "context">,
      "title": <short description under 15 words>,
      "detail": <explanation 1-2 sentences, grounded in fact>
    }
  ]
}

Rules:
- highlights: extract 8-12 significant quotes. Include the moments that most directly drove the bias score. Always include both left-leaning AND right-leaning quotes if they exist. Neutral quotes should be factual claims or context-setting moments worth noting.
- biasReason: plain English, no jargon
- Only flag things you are highly confident about
- Every fact-check flag must be verifiable against known public information
- Maximum 6 flags
- For guest fields: only populate if confident — use null if unsure
- Return ONLY the JSON, no other text`;

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

  // Return immediately if already done
  if (job.status === "complete" || job.status === "error") {
    return new Response(JSON.stringify(job), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  let transcriptText: string;
  let audioDuration: number | undefined;

  if (job.status === "transcribed") {
    transcriptText = job.transcript || "";
    audioDuration = undefined;
  } else {
    // AssemblyAI polling
    const assemblyKey = Netlify.env.get("ASSEMBLYAI_API_KEY");
    const aaiRes = await fetch(`https://api.assemblyai.com/v2/transcript/${job.transcriptId}`, {
      headers: { authorization: assemblyKey! },
      signal: AbortSignal.timeout(15000),
    });
    const transcript = await aaiRes.json();

    if (transcript.status === "error") {
      const updated = { ...job, status: "error", error: transcript.error };
      await store.setJSON(jobId, updated);
      return new Response(JSON.stringify(updated), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (transcript.status !== "completed") {
      return new Response(JSON.stringify({ status: "transcribing", jobId }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    transcriptText = transcript.text || "";
    audioDuration = transcript.audio_duration;
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
      throw new Error(`Claude HTTP ${claudeRes.status}`);
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

  const result = {
    status: "complete",
    jobId,
    url: job.url,
    canonicalKey: job.canonicalKey,
    episodeTitle: job.episodeTitle || "Podcast Episode",
    showName: job.showName || "",
    duration: audioDuration ? `${Math.round(audioDuration / 60)} min` : "Unknown",
    ...analysis,
    guest: analysis.guest || null,
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

  return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config: Config = { path: "/api/status/:jobId", timeout: 300 };
