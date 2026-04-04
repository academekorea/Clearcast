import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const PROMPT_1 = `You are a media literacy expert analyzing a podcast transcript. Your job is to give listeners honest, verifiable intelligence about what they are actually hearing.

Return ONLY a valid JSON object (no markdown, no explanation, no preamble):
{
  "biasScore": <number -100 to +100, where -100=far left, 0=center, +100=far right. Base this on: loaded language, framing of issues, which positions are stated as fact vs opinion, which voices get unchallenged airtime, what policy positions are implicitly or explicitly endorsed>,
  "biasLabel": <"Far left"|"Lean left"|"Center"|"Lean right"|"Far right">,
  "factualityLabel": <"Mostly factual"|"Mixed factuality"|"Unreliable">,
  "omissionRisk": <"Low"|"Med"|"High">,
  "summary": <2-3 sentence plain English summary of what this episode is about and its overall political slant>,
  "audioLean": {
    "leftPct": <number 0-100, percentage of audio time that leans left based on language, framing, and positions expressed>,
    "centerPct": <number 0-100, percentage that is factual/neutral/balanced>,
    "rightPct": <number 0-100, percentage that leans right>,
    "basis": <1 sentence explaining what specific linguistic or positional signals drove this breakdown>
  },
  "hostTrustScore": <number 0-100, how much the host uses parasocial trust-building language>,
  "hostTrustLabel": <"Low influence"|"Moderate influence"|"High influence">
}

Rules:
- audioLean percentages MUST sum to exactly 100
- audioLean must be grounded in specific verifiable signals from the transcript
- Do NOT guess or average — if the content is genuinely neutral, centerPct should be high`;

const PROMPT_2 = `You are a media literacy expert analyzing a podcast transcript. Your job is to give listeners honest, verifiable intelligence about what they are actually hearing.

Return ONLY a valid JSON object (no markdown, no explanation, no preamble):
{
  "topicBreakdown": [
    {"topic": <string 2-4 words>, "percentage": <0-100>, "lean": <"left"|"center"|"right"|"neutral">}
  ],
  "keyQuotes": [
    {"quote": <under 30 words>, "concern": <"low"|"medium"|"high">, "note": <1 sentence why this is notable>}
  ],
  "missingVoices": [<string: perspective conspicuously absent, 3-5 words each>],
  "sponsorConflicts": [<string: sponsor/content conflict if detected>],
  "flags": [
    {"type": <"fact-check"|"framing"|"omission"|"sponsor-note"|"context">, "title": <under 15 words>, "detail": <1-2 sentences>}
  ]
}

Rules:
- topicBreakdown: max 5 topics, percentages sum to 100
- keyQuotes: max 3, only if genuinely notable
- missingVoices: max 4
- flags: max 6, high confidence only
- If something is not detectable, use empty arrays`;

export default async (req: Request) => {
  const url = new URL(req.url);
  const parts = url.pathname.split("/");
  const jobId = parts[parts.length - 1];

  if (!jobId) {
    return new Response(JSON.stringify({ error: "Job ID required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const store = getStore("clearcast-jobs");
    const job = await store.get(jobId, { type: "json" }) as any;

    if (!job) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }

    if (job.status === "complete" || job.status === "error") {
      return new Response(JSON.stringify(job), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");

    // ── Phase 2: headline metrics are done, now get details ──
    if (job.status === "partial") {
      const text = job._transcript || "";
      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": anthropicKey!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1200,
          messages: [{ role: "user", content: `${PROMPT_2}\n\nTranscript:\n${text}` }],
        }),
      });

      let details: any = { topicBreakdown: [], keyQuotes: [], missingVoices: [], sponsorConflicts: [], flags: [] };
      if (claudeRes.ok) {
        const cd = await claudeRes.json();
        try { details = JSON.parse((cd.content?.[0]?.text || "{}").replace(/```json|```/g, "").trim()); } catch { /**/ }
      }

      const result = {
        ...job,
        status: "complete",
        _transcript: undefined,
        topicBreakdown: details.topicBreakdown || [],
        keyQuotes: details.keyQuotes || [],
        missingVoices: details.missingVoices || [],
        sponsorConflicts: details.sponsorConflicts || [],
        flags: details.flags || [],
      };

      await store.setJSON(jobId, result);

      if (job.showSlug) {
        try {
          const showStore = getStore("clearcast-shows");
          const existing = await showStore.get(job.showSlug, { type: "json" }).catch(() => null) as any;
          const episodeIds: string[] = existing?.episodeIds || [];
          if (!episodeIds.includes(jobId)) episodeIds.unshift(jobId);
          await showStore.setJSON(job.showSlug, {
            name: job.showName || existing?.name || job.showSlug,
            artwork: job.showArtwork || existing?.artwork || "",
            feedUrl: job.showFeedUrl || existing?.feedUrl || "",
            episodeIds: episodeIds.slice(0, 100),
            updatedAt: Date.now(),
          });
        } catch { /* non-critical */ }
      }

      return new Response(JSON.stringify(result), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // ── Resolve transcript text — either from pre-fetched captions or AssemblyAI ──
    let transcriptText = "";
    let transcriptDuration = "";
    let transcriptTitle = "";

    if (job.status === "transcribed") {
      transcriptText = job.transcript || "";
      transcriptDuration = job.duration || "";
      transcriptTitle = job.episodeTitle
        || transcriptText.split(/[.!?]/)[0]?.slice(0, 80)
        || "YouTube episode";
    } else {
      // AssemblyAI polling path
      const assemblyKey = Netlify.env.get("ASSEMBLYAI_API_KEY");
      const aaiRes = await fetch(`https://api.assemblyai.com/v2/transcript/${job.transcriptId}`, {
        headers: { "authorization": assemblyKey! },
      });
      const transcript = await aaiRes.json();

      if (transcript.status === "error") {
        const updated = { ...job, status: "error", error: transcript.error || "Transcription failed" };
        await store.setJSON(jobId, updated);
        return new Response(JSON.stringify(updated), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }

      if (transcript.status !== "completed") {
        return new Response(JSON.stringify({ ...job, status: "transcribing" }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }

      transcriptText = transcript.text || "";
      transcriptDuration = transcript.audio_duration
        ? `${Math.round(transcript.audio_duration / 60)} min` : "";
      transcriptTitle = job.episodeTitle
        || transcript.chapters?.[0]?.headline
        || transcript.utterances?.[0]?.text?.split(".")[0]?.slice(0, 80)
        || "Podcast episode";
    }

    // ── Phase 1: get headline metrics, return immediately as "partial" ──
    const text = transcriptText.split(" ").slice(0, 10000).join(" ");

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": anthropicKey!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 800,
        messages: [{ role: "user", content: `${PROMPT_1}\n\nTranscript:\n${text}` }],
      }),
    });

    if (!claudeRes.ok) {
      const updated = { ...job, status: "error", error: "Analysis error. Please try again." };
      await store.setJSON(jobId, updated);
      return new Response(JSON.stringify(updated), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    const claudeData = await claudeRes.json();
    let analysis: any = { biasLabel: "Center", factualityLabel: "Mostly factual", omissionRisk: "Low", biasScore: 0, summary: "", hostTrustScore: 0, hostTrustLabel: "Low influence" };
    try { analysis = JSON.parse((claudeData.content?.[0]?.text || "{}").replace(/```json|```/g, "").trim()); } catch { /**/ }

    // Fallback audioLean if Claude didn't return it
    const score = analysis.biasScore ?? 0;
    if (!analysis.audioLean || typeof analysis.audioLean.leftPct === 'undefined') {
      const absScore = Math.abs(score);
      const extremePct = Math.round(absScore * 0.7);
      const centerPct = Math.max(10, 80 - absScore * 0.7);
      const otherPct = 100 - extremePct - Math.round(centerPct);
      if (score < 0) {
        analysis.audioLean = { leftPct: extremePct, centerPct: Math.round(centerPct), rightPct: Math.max(0, otherPct), basis: "Derived from overall bias score analysis" };
      } else if (score > 0) {
        analysis.audioLean = { leftPct: Math.max(0, otherPct), centerPct: Math.round(centerPct), rightPct: extremePct, basis: "Derived from overall bias score analysis" };
      } else {
        analysis.audioLean = { leftPct: 10, centerPct: 80, rightPct: 10, basis: "Content appears balanced across the political spectrum" };
      }
    }
    const al = analysis.audioLean;
    if (al.leftPct + al.centerPct + al.rightPct !== 100) {
      al.centerPct = 100 - al.leftPct - al.rightPct;
    }

    const partial = {
      status: "partial",
      jobId,
      url: job.url,
      episodeTitle: transcriptTitle,
      showName: job.showName || null,
      showSlug: job.showSlug || null,
      showArtwork: job.showArtwork || null,
      showFeedUrl: job.showFeedUrl || null,
      duration: transcriptDuration,
      wordCount: transcriptText.split(" ").length,
      _transcript: text,
      ...analysis,
    };

    await store.setJSON(jobId, partial);

    // Return without _transcript to keep response lean
    const { _transcript: _t, ...partialForClient } = partial;
    return new Response(JSON.stringify(partialForClient), {
      status: 200, headers: { "Content-Type": "application/json" },
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ status: "error", error: e?.message || "Unknown error" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/status/:jobId" };
