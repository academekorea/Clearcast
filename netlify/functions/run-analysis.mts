import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const ANALYSIS_PROMPT = `You are a media literacy expert analyzing a podcast transcript across 6 dimensions of bias and credibility.

Analyze the transcript and return a JSON object with this EXACT structure — no extra fields, no markdown:
{
  "biasScore": <number -100 (far left) to +100 (far right)>,
  "biasLabel": <"Far left" | "Lean left" | "Center" | "Lean right" | "Far right">,
  "dimensions": {
    "politicalLean": {
      "score": <-100 to +100>,
      "label": <"Far left" | "Lean left" | "Center" | "Lean right" | "Far right">,
      "evidence": [<up to 2 short transcript quotes that show this lean, each under 25 words>]
    },
    "factualDensity": {
      "score": <0 to 100, where 100 = all claims sourced>,
      "label": <"High" | "Medium" | "Low">,
      "evidence": [<up to 2 examples of sourced or unsourced claims>]
    },
    "sourceDiversity": {
      "score": <0 to 100, where 100 = many diverse sources>,
      "label": <"Strong" | "Moderate" | "Weak">,
      "evidence": [<up to 2 notes on sources cited or missing>]
    },
    "framingPatterns": {
      "score": <0 to 100, where 100 = highly loaded language>,
      "label": <"Neutral" | "Somewhat loaded" | "Highly loaded">,
      "evidence": [<up to 2 specific loaded phrases or neutral examples>]
    },
    "hostCredibility": {
      "score": <0 to 100, where 100 = very credible>,
      "label": <"Strong" | "Moderate" | "Weak">,
      "evidence": [<up to 2 notes on corrections, pushback, or citation quality>]
    },
    "omissionRisk": {
      "score": <0 to 100, where 100 = major omissions>,
      "label": <"Low" | "Medium" | "High">,
      "evidence": [<up to 2 topics or perspectives that were missing>]
    }
  },
  "factualityLabel": <"Mostly factual" | "Mixed factuality" | "Unreliable">,
  "summary": <2-3 sentence plain English summary of what this episode is about and how it leans>,
  "flags": [
    {
      "type": <"fact-check" | "framing" | "omission" | "sponsor-note" | "context">,
      "title": <short description under 15 words>,
      "detail": <explanation 1-2 sentences, grounded in fact>,
      "citations": [
        {
          "timestamp": <"MM:SS" or "" if unknown>,
          "quote": <exact short quote from transcript, under 30 words>,
          "explanation": <why this quote is relevant, 1 sentence>
        }
      ]
    }
  ],
  "guest": {
    "name": <string — the main guest or interviewee full name, null if none>,
    "title": <string — their role or title e.g. "CEO, NVIDIA", null if unknown>,
    "organization": <string — their company or organization, null if unknown>
  },
  "hostTrustScore": <0 to 100 — overall host credibility score>,
  "keyFindings": [
    {
      "title": <finding title under 10 words>,
      "detail": <1-2 sentence explanation>
    }
  ]
}

Rules:
- Only flag things you are highly confident about based on the transcript
- Every fact-check flag must be verifiable against known public information
- Be specific — cite actual words from the transcript where possible
- Maximum 6 flags, maximum 3 keyFindings
- All scores are integers
- Return ONLY the JSON object, no markdown, no preamble`;

export default async (req: Request) => {
  // AssemblyAI sends a POST webhook when transcription completes
  // It also accepts direct POST calls for manual triggering
  if (req.method !== "POST") {
    return new Response("OK", { status: 200 });
  }

  const body = await req.json();

  // AssemblyAI webhook payload has transcript_id and status
  const transcriptId = body.transcript_id;
  const webhookStatus = body.status;

  // Only process completed transcriptions
  if (webhookStatus && webhookStatus !== "completed") {
    return new Response("OK", { status: 200 });
  }

  if (!transcriptId) {
    return new Response("Missing transcript_id", { status: 400 });
  }

  const store = getStore("podlens-jobs");
  const job = await store.get(transcriptId, { type: "json" }) as any;

  if (!job) {
    return new Response("Job not found", { status: 404 });
  }

  // Already processed
  if (job.status === "complete" || job.status === "error") {
    return new Response("OK", { status: 200 });
  }

  // Fetch the full transcript from AssemblyAI
  const assemblyKey = Netlify.env.get("ASSEMBLYAI_API_KEY");
  const transcriptRes = await fetch(
    `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
    { headers: { authorization: assemblyKey! } }
  );
  const transcript = await transcriptRes.json();

  if (transcript.status !== "completed") {
    return new Response("Not completed yet", { status: 200 });
  }

  // Mark as analyzing
  await store.setJSON(transcriptId, { ...job, status: "analyzing" });

  // Run Claude analysis
  const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");
  const words = (transcript.text || "").split(" ");
  const truncated = words.slice(0, 6000).join(" ");

  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1700,
        messages: [
          {
            role: "user",
            content: `${ANALYSIS_PROMPT}\n\nTranscript:\n${truncated}`,
          },
        ],
      }),
    });

    if (!claudeRes.ok) {
      throw new Error("Claude API error: " + await claudeRes.text());
    }

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content?.[0]?.text || "{}";

    let analysis;
    try {
      analysis = JSON.parse(rawText.replace(/```json|```/g, "").trim());
    } catch {
      analysis = {
        biasScore: 0,
        biasLabel: "Center",
        factualityLabel: "Mostly factual",
        omissionRisk: "Low",
        summary: "Analysis could not be parsed.",
        flags: [],
      };
    }

    const result = {
      status: "complete",
      jobId: transcriptId,
      url: job.url,
      episodeTitle: job.episodeTitle || transcript.chapters?.[0]?.headline || "Podcast Episode",
      showName: job.showName || "",
      duration: transcript.audio_duration
        ? `${Math.round(transcript.audio_duration / 60)} min`
        : "Unknown",
      ...analysis,
    };

    await store.setJSON(transcriptId, result);

  } catch (err: any) {
    await store.setJSON(transcriptId, {
      status: "error",
      jobId: transcriptId,
      error: err.message || "Analysis failed",
    });
  }

  return new Response("OK", { status: 200 });
};

export const config: Config = {
  path: "/api/run-analysis",
  timeout: 60,
};
