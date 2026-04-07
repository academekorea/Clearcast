import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const ANALYSIS_PROMPT = `You are a media literacy expert analyzing a podcast transcript for bias, factual accuracy, and framing patterns.

Analyze the transcript and return a JSON object with this exact structure:
{
  "biasScore": <number from -100 (far left) to +100 (far right)>,
  "biasLabel": <"Far left" | "Lean left" | "Center" | "Lean right" | "Far right">,
  "factualityLabel": <"Mostly factual" | "Mixed factuality" | "Unreliable">,
  "omissionRisk": <"Low" | "Med" | "High">,
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
    return new Response("Method not allowed", { status: 405 });
  }

  const { jobId, transcriptText, jobData } = await req.json();
  if (!jobId || !transcriptText) {
    return new Response(JSON.stringify({ error: "jobId and transcriptText required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const store = getStore("podlens-jobs");
  const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");

  // Truncate to ~8000 words to stay within token limits
  const truncated = transcriptText.split(" ").slice(0, 8000).join(" ");

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
      const err = await claudeRes.text();
      await store.setJSON(jobId, { ...jobData, status: "error", error: "Claude error: " + err });
      return new Response(JSON.stringify({ error: "Claude error" }), { status: 500 });
    }

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content?.[0]?.text || "{}";

    let analysis;
    try {
      analysis = JSON.parse(rawText.replace(/```json|```/g, "").trim());
    } catch {
      analysis = { error: "Failed to parse analysis" };
    }

    const episodeTitle = jobData.episodeTitle || "Podcast episode";

    const result = {
      status: "complete",
      jobId,
      url: jobData.url,
      episodeTitle,
      showName: jobData.showName || "",
      ...analysis,
    };

    await store.setJSON(jobId, result);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    await store.setJSON(jobId, { ...jobData, status: "error", error: e?.message || "Analysis failed" });
    return new Response(JSON.stringify({ error: "Analysis failed" }), { status: 500 });
  }
};

export const config: Config = {
  path: "/api/run-analysis",
  timeout: 60,
};
