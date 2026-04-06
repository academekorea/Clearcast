import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { sbInsert, sbUpdate, trackEvent } from "./lib/supabase.js";

// ── KOREAN LANGUAGE DETECTION ─────────────────────────────────────────────
function isKoreanTranscript(text: string): boolean {
  const koreanChars = (text.match(/[가-힣]/g) || []).length;
  return koreanChars >= 10 && koreanChars / text.length > 0.05;
}

const KOREAN_CONTEXT = `
Analyze in Korean political context:
보수 (conservative): national security, pro-US, free market, traditional values, Chosun Ilbo framing.
진보 (progressive): welfare expansion, labor rights, chaebol reform, North Korea dialogue, Hankyoreh framing.
중립 (center/balanced): evidence-based, multiple perspectives, avoids political framing.
Use these labels: leftLabel='진보 성향', centerLabel='중립', rightLabel='보수 성향'.
Return ALL analysis text (summary, flag titles, flag details, topics, quotes, missingVoices, audioScript) in Korean.`;

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
    "basis": <1 sentence explaining what specific linguistic or positional signals drove this breakdown>,
    "citations": [
      {"quote": <verbatim excerpt under 25 words>, "timestamp": <estimated timestamp like "~12:30" or "" if unknown>, "explanation": <1 sentence why this quote supports the lean assessment>}
    ]
  },
  "hostTrustScore": <number 0-100, how much the host uses parasocial trust-building language>,
  "hostTrustLabel": <"Low influence"|"Moderate influence"|"High influence">,
  "audioScript": <200-220 word spoken briefing. You are a trusted, curious friend giving context before they listen. Structure: (1) Opening — one sentence on what this episode is and who it is from. (2) The lean — two sentences on which direction it leans and the single clearest reason why, framed as a framing pattern not a flaw — e.g. "the episode consistently frames X as Y" rather than "the host is biased". (3) Key findings — three to four sentences covering the most important things to know going in. (4) Missing perspectives — one to two sentences on what voices or angles are absent, framed as "one thing worth knowing is that..." (5) Sponsor note — one sentence only if sponsors are present, framed as "worth knowing the episode is sponsored by..."; skip entirely if no sponsors detected. (6) Closing — one warm sentence: "overall this episode is worth listening to if..." and complete the thought based on the content. Tone: curious and helpful, never preachy, never alarmist, never judgmental. This is a gift of context, not a verdict. Will be read aloud by a text-to-speech engine — write for the ear, not the eye.>
}

Rules:
- audioLean percentages MUST sum to exactly 100
- audioLean must be grounded in specific verifiable signals from the transcript
- audioLean.citations: provide 2-3 quotes that best illustrate the lean; use empty array if transcript is genuinely neutral
- Do NOT guess or average — if the content is genuinely neutral, centerPct should be high
- audioScript must be 200-220 words, plain prose, no bullet points, no markdown, no section headings`;

const PROMPT_2 = `You are a media literacy expert analyzing a podcast transcript. Your job is to give listeners honest, verifiable intelligence about what they are actually hearing.

Return ONLY a valid JSON object (no markdown, no explanation, no preamble):
{
  "topicBreakdown": [
    {"topic": <descriptive topic name, can be up to 8 words — use full natural phrasing, never abbreviate>, "percentage": <0-100>, "lean": <"left"|"center"|"right"|"neutral">}
  ],
  "keyQuotes": [
    {"quote": <under 30 words>, "concern": <"low"|"medium"|"high">, "note": <1 sentence why this is notable>}
  ],
  "missingVoices": [<string: perspective conspicuously absent — write as a full noun phrase, e.g. "Healthcare workers directly affected", "Conservative economists", "Immigrant community voices">],
  "sponsorConflicts": [<string: sponsor/content conflict if detected>],
  "flags": [
    {
      "type": <"fact-check"|"framing"|"omission"|"sponsor-note"|"context">,
      "title": <under 15 words>,
      "detail": <1-2 sentences>,
      "citations": [
        {"quote": <verbatim excerpt under 25 words>, "timestamp": <estimated timestamp like "~8:45" or "" if unknown>, "explanation": <1 sentence why this quote supports this flag>}
      ]
    }
  ]
}

Rules:
- topicBreakdown: 5-8 topics, percentages sum to 100, sort descending by percentage, use full descriptive names
- keyQuotes: max 3, only if genuinely notable
- missingVoices: max 4
- flags: max 6, high confidence only; each flag should have 1-2 citations
- If something is not detectable, use empty arrays`;

// ── MAIN HANDLER ──────────────────────────────────────────────────────────

export default async (req: Request) => {
  const store = getStore("podlens-jobs");
  let jobId = "";

  try {
    const body = await req.json();
    jobId = body.jobId;
    if (!jobId) return new Response("missing jobId", { status: 400 });

    const job = await store.get(jobId, { type: "json" }) as any;
    if (!job) {
      console.error(`[worker] Job ${jobId} not found in blob store`);
      return new Response("job not found", { status: 404 });
    }

    // Skip if already processed
    if (job.status === "complete" || job.status === "error") {
      return new Response("already done", { status: 200 });
    }

    const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");
    const assemblyKey = Netlify.env.get("ASSEMBLYAI_API_KEY");

    let transcriptText = "";
    let transcriptDuration = "";
    let transcriptTitle = "";

    // ── Step 1: Get transcript ────────────────────────────────────────────
    if (job.status === "transcribing") {
      if (!assemblyKey) {
        await store.setJSON(jobId, { ...job, status: "error", error: "AssemblyAI not configured" });
        return new Response("error", { status: 500 });
      }

      // Poll AssemblyAI — up to 5 min (60 × 5s)
      let transcript: any = null;
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${job.transcriptId}`, {
          headers: { authorization: assemblyKey },
        });
        const data = await pollRes.json();

        if (data.status === "completed") {
          transcript = data;
          break;
        }
        if (data.status === "error") {
          await store.setJSON(jobId, { ...job, status: "error", error: data.error || "Transcription failed" });
          return new Response("transcription error", { status: 200 });
        }
      }

      if (!transcript) {
        await store.setJSON(jobId, { ...job, status: "error", error: "Transcription timed out after 5 minutes" });
        return new Response("timeout", { status: 200 });
      }

      transcriptText = transcript.text || "";
      transcriptDuration = transcript.audio_duration
        ? `${Math.round(transcript.audio_duration / 60)} min` : "";
      transcriptTitle = job.episodeTitle
        || transcript.chapters?.[0]?.headline
        || transcript.utterances?.[0]?.text?.split(".")[0]?.slice(0, 80)
        || "Podcast episode";

    } else if (job.status === "transcribed") {
      // YouTube captions path — transcript already available
      transcriptText = job.transcript || "";
      transcriptDuration = job.duration || "";
      transcriptTitle = job.episodeTitle
        || transcriptText.split(/[.!?]/)[0]?.slice(0, 80)
        || "YouTube episode";
    }

    if (!transcriptText) {
      await store.setJSON(jobId, { ...job, status: "error", error: "No transcript available" });
      return new Response("no transcript", { status: 200 });
    }

    // ── Step 2: Phase 1 Claude — headline metrics ─────────────────────────
    const text = transcriptText.split(" ").slice(0, 10000).join(" ");
    const isKorean = isKoreanTranscript(text);
    const prompt1 = isKorean ? `${PROMPT_1}\n\n${KOREAN_CONTEXT}` : PROMPT_1;

    let analysis: any = {
      biasLabel: "Center", factualityLabel: "Mostly factual", omissionRisk: "Low",
      biasScore: 0, summary: "", hostTrustScore: 0, hostTrustLabel: "Low influence",
      audioScript: null,
    };

    const claudeRes1 = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": anthropicKey!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 800,
        messages: [{ role: "user", content: `${prompt1}\n\nTranscript:\n${text}` }],
      }),
    });

    if (claudeRes1.ok) {
      const cd1 = await claudeRes1.json();
      try { analysis = JSON.parse((cd1.content?.[0]?.text || "{}").replace(/```json|```/g, "").trim()); } catch { /**/ }
    } else {
      console.error(`[worker] Phase 1 Claude failed: ${claudeRes1.status}`);
    }

    // audioLean fallback
    const score = analysis.biasScore ?? 0;
    if (!analysis.audioLean || typeof analysis.audioLean.leftPct === "undefined") {
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

    // Store partial (frontend can show this while Phase 2 runs)
    const partial = {
      status: "partial",
      jobId,
      url: job.url,
      episodeTitle: transcriptTitle,
      showName: job.showName || null,
      showSlug: job.showSlug || null,
      showArtwork: job.showArtwork || null,
      showFeedUrl: job.showFeedUrl || null,
      userId: job.userId || null,
      userPlan: job.userPlan || "free",
      duration: transcriptDuration,
      wordCount: transcriptText.split(" ").length,
      _transcript: text,
      audioScript: analysis.audioScript || null,
      ...analysis,
    };

    await store.setJSON(jobId, partial);

    // ── Step 3: Phase 2 Claude — topic breakdown + flags ─────────────────
    const isKorean2 = isKoreanTranscript(text);
    const prompt2 = isKorean2 ? `${PROMPT_2}\n\n${KOREAN_CONTEXT}` : PROMPT_2;

    let details: any = { topicBreakdown: [], keyQuotes: [], missingVoices: [], sponsorConflicts: [], flags: [] };

    const claudeRes2 = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": anthropicKey!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1200,
        messages: [{ role: "user", content: `${prompt2}\n\nTranscript:\n${text}` }],
      }),
    });

    if (claudeRes2.ok) {
      const cd2 = await claudeRes2.json();
      try { details = JSON.parse((cd2.content?.[0]?.text || "{}").replace(/```json|```/g, "").trim()); } catch { /**/ }
    } else {
      console.error(`[worker] Phase 2 Claude failed: ${claudeRes2.status}`);
    }

    // ── Step 4: Store complete result ─────────────────────────────────────
    const result: any = {
      ...partial,
      status: "complete",
      _transcript: undefined,
      topicBreakdown: details.topicBreakdown || [],
      keyQuotes: details.keyQuotes || [],
      missingVoices: details.missingVoices || [],
      sponsorConflicts: details.sponsorConflicts || [],
      flags: details.flags || [],
    };

    await store.setJSON(jobId, result);

    // ── Step 5: Supabase writes ───────────────────────────────────────────
    const alFinal = result.audioLean || {};
    const shareId = result.shareId || jobId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 32);
    const resultForBackup = { ...result };
    delete resultForBackup._transcript;

    sbInsert("analyses", {
      id: jobId,
      user_id: result.userId || null,
      show_name: result.showName || null,
      show_slug: result.showSlug || null,
      show_artwork: result.showArtwork || null,
      episode_title: result.episodeTitle || null,
      episode_url: result.url || null,
      bias_left_pct: alFinal.leftPct ?? 0,
      bias_center_pct: alFinal.centerPct ?? 0,
      bias_right_pct: alFinal.rightPct ?? 0,
      bias_label: result.biasLabel || null,
      host_trust_score: result.hostTrustScore || null,
      summary: result.summary || null,
      share_id: shareId,
      share_count: 0,
      duration: result.duration || null,
      word_count: result.wordCount || null,
      result_json: resultForBackup,
      cache_key: jobId,
      cached_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }).catch(() => {});

    if (result.showSlug) {
      sbUpdate("shows", { slug: result.showSlug }, { total_analyses: 1 }).catch(() => {});
    }

    trackEvent(result.userId, "analysis_completed", {
      show_name: result.showName,
      episode_title: result.episodeTitle,
      bias_label: result.biasLabel,
      duration: result.duration,
    });

    // Platform stats counter
    try {
      const statsStore = getStore("podlens-cache");
      const statsKey = "platform-stats";
      const existing = await statsStore.get(statsKey, { type: "json" }).catch(() => null) as any || {};
      const now = Date.now();
      const isNewWeek = now - (existing.weekStart || 0) > 7 * 24 * 60 * 60 * 1000;
      await statsStore.setJSON(statsKey, {
        totalAnalyses: (existing.totalAnalyses || 0) + 1,
        analysesThisWeek: isNewWeek ? 1 : (existing.analysesThisWeek || 0) + 1,
        weekStart: isNewWeek ? now : (existing.weekStart || now),
        lastUpdated: now,
      });
    } catch { /**/ }

    // Show store update
    if (result.showSlug) {
      try {
        const showStore = getStore("podlens-shows");
        const existing = await showStore.get(result.showSlug, { type: "json" }).catch(() => null) as any;
        const episodeIds: string[] = existing?.episodeIds || [];
        if (!episodeIds.includes(jobId)) episodeIds.unshift(jobId);
        await showStore.setJSON(result.showSlug, {
          name: result.showName || existing?.name || result.showSlug,
          artwork: result.showArtwork || existing?.artwork || "",
          feedUrl: result.showFeedUrl || existing?.feedUrl || "",
          episodeIds: episodeIds.slice(0, 100),
          updatedAt: Date.now(),
        });
      } catch { /**/ }
    }

    console.log(`[worker] Job ${jobId} complete — ${result.biasLabel}, ${result.duration}`);
    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });

  } catch (e: any) {
    console.error(`[worker] Fatal error for job ${jobId}:`, e);
    if (jobId) {
      const store2 = getStore("podlens-jobs");
      await store2.setJSON(jobId, { status: "error", jobId, error: e?.message || "Worker failed" }).catch(() => {});
    }
    return new Response(JSON.stringify({ error: e?.message }), { status: 500 });
  }
};

export const config: Config = { path: "/api/analyze-worker" };
