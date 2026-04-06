import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

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
  "biasScore": <number -100 to +100, where -100=far left, 0=center, +100=far right>,
  "biasLabel": <"Far left"|"Lean left"|"Center"|"Lean right"|"Far right">,
  "factualityLabel": <"Mostly factual"|"Mixed factuality"|"Unreliable">,
  "omissionRisk": <"Low"|"Med"|"High">,
  "summary": <2-3 sentence plain English summary of what this episode is about and its overall political slant>,
  "audioLean": {
    "leftPct": <number 0-100>,
    "centerPct": <number 0-100>,
    "rightPct": <number 0-100>,
    "basis": <1 sentence explaining what specific signals drove this breakdown>,
    "citations": [
      {"quote": <verbatim excerpt under 25 words>, "timestamp": <estimated like "~12:30" or "">, "explanation": <1 sentence why this quote supports the lean>}
    ]
  },
  "hostTrustScore": <number 0-100>,
  "hostTrustLabel": <"Low influence"|"Moderate influence"|"High influence">,
  "audioScript": <200-220 word spoken briefing — curious friend giving context, never preachy, write for the ear>
}

Rules:
- audioLean percentages MUST sum to exactly 100
- audioLean.citations: provide 2-3 quotes; use empty array if genuinely neutral
- Do NOT guess — if content is genuinely neutral, centerPct should be high
- audioScript must be 200-220 words, plain prose, no bullet points`;

const PROMPT_2 = `You are a media literacy expert analyzing a podcast transcript. Your job is to give listeners honest, verifiable intelligence about what they are actually hearing.

Return ONLY a valid JSON object (no markdown, no explanation, no preamble):
{
  "topicBreakdown": [
    {"topic": <descriptive topic name up to 8 words — never abbreviate>, "percentage": <0-100>, "lean": <"left"|"center"|"right"|"neutral">}
  ],
  "keyQuotes": [
    {"quote": <under 30 words>, "concern": <"low"|"medium"|"high">, "note": <1 sentence why notable>}
  ],
  "missingVoices": [<string: perspective conspicuously absent — full noun phrase>],
  "sponsorConflicts": [<string: sponsor/content conflict if detected>],
  "flags": [
    {
      "type": <"fact-check"|"framing"|"omission"|"sponsor-note"|"context">,
      "title": <under 15 words>,
      "detail": <1-2 sentences>,
      "citations": [
        {"quote": <verbatim excerpt under 25 words>, "timestamp": <estimated like "~8:45" or "">, "explanation": <1 sentence why this supports this flag>}
      ]
    }
  ]
}

Rules:
- topicBreakdown: 5-8 topics, percentages sum to 100, sort descending, use full descriptive names
- keyQuotes: max 3, only if genuinely notable
- missingVoices: max 4
- flags: max 6, high confidence only; each flag should have 1-2 citations
- If something is not detectable, use empty arrays`;

// ── MAIN HANDLER ──────────────────────────────────────────────────────────

export default async (req: Request) => {
  // ── Verify webhook secret ──────────────────────────────────────────────
  const secret = req.headers.get("x-webhook-secret");
  const expectedSecret = Netlify.env.get("WEBHOOK_SECRET") || "podlens2026";
  if (secret !== expectedSecret) {
    console.error("[webhook] Unauthorized — bad secret");
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const { transcript_id, status } = payload;
  console.log(`[webhook] received transcript_id=${transcript_id} status=${status}`);

  const store = getStore("podlens-jobs");

  // ── Error from AssemblyAI ──────────────────────────────────────────────
  if (status === "error") {
    const job = await store.get(transcript_id, { type: "json" }) as any;
    if (job) {
      await store.setJSON(transcript_id, { ...job, status: "error", error: payload.error || "Transcription failed" });
    }
    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  // ── Only process completed transcripts ────────────────────────────────
  if (status !== "completed") {
    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  // ── Fetch full transcript from AssemblyAI ──────────────────────────────
  const assemblyKey = Netlify.env.get("ASSEMBLYAI_API_KEY");
  if (!assemblyKey) {
    console.error("[webhook] ASSEMBLYAI_API_KEY not set");
    return new Response("ok", { status: 200 });
  }

  let transcriptText = "";
  let duration = "";
  try {
    const transcriptRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcript_id}`, {
      headers: { authorization: assemblyKey },
      signal: AbortSignal.timeout(10000),
    });
    const data = await transcriptRes.json();
    transcriptText = data.text || "";
    duration = data.audio_duration ? `${Math.round(data.audio_duration / 60)} min` : "";
  } catch (e: any) {
    console.error("[webhook] Failed to fetch transcript:", e?.message);
    return new Response("ok", { status: 200 });
  }

  // ── Read job metadata from blob ────────────────────────────────────────
  const job = await store.get(transcript_id, { type: "json" }) as any;
  if (!job) {
    console.error(`[webhook] Job ${transcript_id} not found in blob store`);
    return new Response("ok", { status: 200 });
  }

  const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    console.error("[webhook] ANTHROPIC_API_KEY not set");
    await store.setJSON(transcript_id, { ...job, status: "error", error: "AI analysis not configured" });
    return new Response("ok", { status: 200 });
  }

  const text = transcriptText.split(" ").slice(0, 10000).join(" ");
  const isKorean = isKoreanTranscript(text);
  const prompt1 = isKorean ? `${PROMPT_1}\n\n${KOREAN_CONTEXT}` : PROMPT_1;
  const prompt2 = isKorean ? `${PROMPT_2}\n\n${KOREAN_CONTEXT}` : PROMPT_2;

  // ── Phase 1 Claude — headline metrics ─────────────────────────────────
  let analysis1: any = {
    biasLabel: "Center", factualityLabel: "Mostly factual", omissionRisk: "Low",
    biasScore: 0, summary: "", hostTrustScore: 0, hostTrustLabel: "Low influence",
    audioScript: null, audioLean: null,
  };

  try {
    const r1 = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 800,
        messages: [{ role: "user", content: `${prompt1}\n\nTranscript:\n${text}` }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (r1.ok) {
      const cd = await r1.json();
      try {
        const parsed = JSON.parse((cd.content?.[0]?.text || "{}").replace(/```json|```/g, "").trim());
        const al = parsed.audioLean;
        if (al && al.leftPct + al.centerPct + al.rightPct !== 100) al.centerPct = 100 - al.leftPct - al.rightPct;
        analysis1 = parsed;
      } catch (e: any) { console.error("[webhook] Phase 1 JSON parse error:", e?.message); }
    }
  } catch (e: any) {
    console.error("[webhook] Phase 1 Claude error:", e?.message);
  }

  // ── Store partial result — frontend can show this while Phase 2 runs ──
  await store.setJSON(transcript_id, {
    ...job,
    status: "partial",
    _transcript: text,
    duration,
    wordCount: transcriptText.split(" ").length,
    ...analysis1,
  });
  console.log(`[webhook] Phase 1 stored for ${transcript_id}`);

  // ── Phase 2 Claude — deep findings ────────────────────────────────────
  let analysis2: any = {
    topicBreakdown: [], keyQuotes: [], missingVoices: [], sponsorConflicts: [], flags: [],
  };

  try {
    const r2 = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1200,
        messages: [{ role: "user", content: `${prompt2}\n\nTranscript:\n${text}` }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (r2.ok) {
      const cd = await r2.json();
      try {
        analysis2 = JSON.parse((cd.content?.[0]?.text || "{}").replace(/```json|```/g, "").trim());
      } catch (e: any) { console.error("[webhook] Phase 2 JSON parse error:", e?.message); }
    }
  } catch (e: any) {
    console.error("[webhook] Phase 2 Claude error:", e?.message);
  }

  // ── Store complete result ──────────────────────────────────────────────
  await store.setJSON(transcript_id, {
    ...job,
    status: "complete",
    _transcript: text,
    duration,
    wordCount: transcriptText.split(" ").length,
    ...analysis1,
    ...analysis2,
  });
  console.log(`[webhook] Analysis complete for ${transcript_id}`);

  return new Response(JSON.stringify({ success: true }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = { path: "/api/transcript-webhook" };
