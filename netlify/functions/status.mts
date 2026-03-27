import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const PROMPT = `You are a media literacy expert analyzing a podcast transcript.

Return ONLY a JSON object with this exact structure (no other text):
{
  "biasScore": <number -100 to +100, negative=left, positive=right>,
  "biasLabel": <"Far left"|"Lean left"|"Center"|"Lean right"|"Far right">,
  "factualityLabel": <"Mostly factual"|"Mixed factuality"|"Unreliable">,
  "omissionRisk": <"Low"|"Med"|"High">,
  "flags": [
    {
      "type": <"fact-check"|"framing"|"omission"|"sponsor-note"|"context">,
      "title": <under 15 words>,
      "detail": <1-2 sentences, factual and specific>
    }
  ]
}

Rules: max 6 flags, only flag things you are highly confident about, be specific not vague.`;

export default async (req: Request) => {
  const url = new URL(req.url);
  const parts = url.pathname.split("/");
  const jobId = parts[parts.length - 1];

  if (!jobId) {
    return new Response(JSON.stringify({ error: "Job ID required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

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

  // Check AssemblyAI v3 status
  const assemblyKey = Netlify.env.get("ASSEMBLYAI_API_KEY");
  const aaiRes = await fetch(`https://api.assemblyai.com/v3/transcripts/${job.transcriptId}`, {
    headers: { "Authorization": assemblyKey! },
  });

  const transcript = await aaiRes.json();

  if (transcript.status === "error") {
    const updated = { ...job, status: "error", error: transcript.error };
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

  // Run Claude analysis
  const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");
  const text = (transcript.text || "").split(" ").slice(0, 8000).join(" ");

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
      messages: [{ role: "user", content: `${PROMPT}\n\nTranscript:\n${text}` }],
    }),
  });

  if (!claudeRes.ok) {
    const err = await claudeRes.text();
    const updated = { ...job, status: "error", error: "Analysis error: " + err };
    await store.setJSON(jobId, updated);
    return new Response(JSON.stringify(updated), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  const claudeData = await claudeRes.json();
  const rawText = claudeData.content?.[0]?.text || "{}";

  let analysis;
  try {
    analysis = JSON.parse(rawText.replace(/```json|```/g, "").trim());
  } catch {
    analysis = { biasLabel: "Center", factualityLabel: "Mostly factual", omissionRisk: "Low", biasScore: 0, flags: [] };
  }

  const duration = transcript.audio_duration
    ? `${Math.round(transcript.audio_duration / 60)} min` : "";

  const result = {
    status: "complete",
    jobId,
    url: job.url,
    episodeTitle: transcript.chapters?.[0]?.headline || "Podcast episode",
    duration,
    ...analysis,
  };

  await store.setJSON(jobId, result);

  return new Response(JSON.stringify(result), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = { path: "/api/status/:jobId" };
