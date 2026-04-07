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
  "flags": [
    {
      "type": <"fact-check" | "framing" | "omission" | "sponsor-note" | "context">,
      "title": <short description under 15 words>,
      "detail": <explanation 1-2 sentences, grounded in fact>
    }
  ]
}

Rules:
- Only flag things you are highly confident about
- Every fact-check flag must be verifiable against known public information
- Be specific, not vague
- Maximum 6 flags
- Return ONLY the JSON, no other text`;

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("OK", { status: 200 });
  }

  const { jobId, transcriptText, episodeTitle, showName, audioUrl, audioDuration } = await req.json();

  const store = getStore("podlens-jobs");
  const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");

  const words = (transcriptText || "").split(" ");
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
        max_tokens: 1500,
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
      jobId,
      url: audioUrl,
      episodeTitle,
      showName,
      duration: audioDuration ? `${Math.round(audioDuration / 60)} min` : "Unknown",
      ...analysis,
    };

    await store.setJSON(jobId, result);

  } catch (err: any) {
    await store.setJSON(jobId, {
      status: "error",
      jobId,
      error: err.message || "Analysis failed",
    });
  }

  return new Response("OK", { status: 200 });
};

export const config: Config = {
  path: "/api/run-analysis",
  timeout: 60,
};
