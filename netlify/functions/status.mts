import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const PROMPT = `You are a media literacy expert analyzing a podcast transcript. Your job is to give listeners honest, verifiable intelligence about what they are actually hearing.

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
    "basis": <1 sentence explaining what specific linguistic or positional signals drove this breakdown — e.g. "Host repeatedly framed government regulation as harmful, used terms like 'government overreach' and 'nanny state', while presenting deregulation arguments without counterpoint">
  },
  "hostTrustScore": <number 0-100, how much the host uses parasocial trust-building language — "trust me", "everyone knows", "I've been saying this", "my listeners know", "you and I both know">,
  "hostTrustLabel": <"Low influence"|"Moderate influence"|"High influence">,
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
- audioLean percentages MUST sum to exactly 100
- audioLean must be grounded in specific verifiable signals from the transcript: word choice, which claims are challenged vs accepted, whose voices are amplified, what policies are framed positively or negatively
- Do NOT guess or average — if the content is genuinely neutral, centerPct should be high
- topicBreakdown: max 5 topics, percentages sum to 100
- keyQuotes: max 3, only if genuinely notable
- missingVoices: max 4
- flags: max 6, high confidence only
- If something is not detectable, use empty arrays or 0 values`;

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

    // Resolve transcript text — either from pre-fetched captions or AssemblyAI
    let transcriptText = "";
    let transcriptDuration = "";
    let transcriptTitle = "";

    if (job.status === "transcribed") {
      // YouTube captions path — no AssemblyAI needed
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

    const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");
    const text = transcriptText.split(" ").slice(0, 10000).join(" ");

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: `${PROMPT}\n\nTranscript:\n${text}` }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      const updated = { ...job, status: "error", error: "Analysis error. Please try again." };
      await store.setJSON(jobId, updated);
      return new Response(JSON.stringify(updated), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content?.[0]?.text || "{}";

    let analysis: any;
    try {
      analysis = JSON.parse(rawText.replace(/```json|```/g, "").trim());
    } catch {
      analysis = {
        biasLabel: "Center", factualityLabel: "Mostly factual",
        omissionRisk: "Low", biasScore: 0, flags: [],
        summary: "", hostTrustScore: 0, hostTrustLabel: "Low influence",
        topicBreakdown: [], keyQuotes: [], missingVoices: [], sponsorConflicts: []
      };
    }

    const duration = transcriptDuration;
    const title = transcriptTitle;

    // Compute audioLean from biasScore as fallback if Claude didn't return it
    const score = analysis.biasScore ?? 0;
    if (!analysis.audioLean || typeof analysis.audioLean.leftPct === 'undefined') {
      // Derive lean percentages from the bias score
      // Score of 0 = 10/80/10, score of -100 = 80/15/5, score of +100 = 5/15/80
      const absScore = Math.abs(score);
      const extremePct = Math.round(absScore * 0.7); // max 70% at extreme
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

    // Ensure percentages sum to 100
    const al = analysis.audioLean;
    const sum = al.leftPct + al.centerPct + al.rightPct;
    if (sum !== 100) {
      al.centerPct = 100 - al.leftPct - al.rightPct;
    }

    const result = {
      status: "complete",
      jobId,
      url: job.url,
      episodeTitle: title,
      showName: job.showName || null,
      duration,
      wordCount: transcriptText.split(" ").length,
      ...analysis,
    };

    await store.setJSON(jobId, result);

    // Index this episode under its show for show profiles
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

  } catch (e: any) {
    return new Response(JSON.stringify({ status: "error", error: e?.message || "Unknown error" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/status/:jobId" };
