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
  const url = new URL(req.url);
  const jobId = url.pathname.split("/").pop();

  if (!jobId) {
    return new Response(JSON.stringify({ error: "Job ID required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const store = getStore("podlens-jobs");
  const job = await store.get(jobId, { type: "json" }) as any;

  if (!job) {
    return new Response(JSON.stringify({ error: "Job not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Already done
  if (job.status === "complete") {
    return new Response(JSON.stringify(job), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (job.status === "error") {
    return new Response(JSON.stringify(job), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Check AssemblyAI transcription status
  const assemblyKey = Netlify.env.get("ASSEMBLYAI_API_KEY");
  const aaiRes = await fetch(`https://api.assemblyai.com/v2/transcript/${job.transcriptId}`, {
    headers: { authorization: assemblyKey! },
  });

  const transcript = await aaiRes.json();

  if (transcript.status === "error") {
    const updated = { ...job, status: "error", error: transcript.error };
    await store.setJSON(jobId, updated);
    return new Response(JSON.stringify(updated), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (transcript.status !== "completed") {
    // Still transcribing
    return new Response(JSON.stringify({ ...job, status: "transcribing" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Transcription done — run Claude analysis
  const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");
  const text = transcript.text || "";

  // Truncate to ~8000 words to stay within token limits
  const words = text.split(" ");
  const truncated = words.slice(0, 8000).join(" ");

  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
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
    const updated = { ...job, status: "error", error: "Claude error: " + err };
    await store.setJSON(jobId, updated);
    return new Response(JSON.stringify(updated), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const claudeData = await claudeRes.json();
  const rawText = claudeData.content?.[0]?.text || "{}";

  let analysis;
  try {
    analysis = JSON.parse(rawText.replace(/```json|```/g, "").trim());
  } catch {
    analysis = { error: "Failed to parse analysis" };
  }

  // Get episode title from transcript chapters or audio URL
  const episodeTitle = transcript.chapters?.[0]?.headline || "Podcast episode";

  const result = {
    status: "complete",
    jobId,
    url: job.url,
    episodeTitle,
    duration: transcript.audio_duration
      ? `${Math.round(transcript.audio_duration / 60)} min`
      : "Unknown",
    ...analysis,
  };

  await store.setJSON(jobId, result);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = {
  path: "/api/status/:jobId",
};
