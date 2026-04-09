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
  "guest": {
    "name": <full name of the main guest, or null if no clear guest>,
    "title": <their job title e.g. "CEO" or "Senator", or null>,
    "organization": <their company/org e.g. "NVIDIA" or "US Senate", or null>,
    "lean": <their perceived political/ideological lean in 3-4 words e.g. "Tech-optimist lean" or "Progressive lean", or null>,
    "episodeCount": <estimated number of times this person has appeared on this show as a string e.g. "3", or null>,
    "twitter": <their Twitter/X handle without @, or null>,
    "website": <their official website URL, or null>
  },
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
- For guest fields: only populate if you are confident — use null if unsure
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

  if (job.status === "complete" || job.status === "error") {
    return new Response(JSON.stringify(job), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  let transcriptText: string;
  let audioDuration: number | undefined;

  if (job.status === "transcribed") {
    // YouTube captions path — transcript already in blob, skip AssemblyAI
    transcriptText = job.transcript || "";
    audioDuration = undefined;
  } else {
    // AssemblyAI polling path
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
      return new Response(JSON.stringify({ status: "transcribing", jobId }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    transcriptText = transcript.text || "";
    audioDuration = transcript.audio_duration;
  }

  // Transcription done — run Claude inline
  const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");
  const words = transcriptText.split(" ");
  const truncated = words.slice(0, 8000).join(" ");

  let claudeRes: Response | null = null;
  let claudeErr: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
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
          max_tokens: 1500,
          messages: [{ role: "user", content: `${ANALYSIS_PROMPT}\n\nTranscript:\n${truncated}` }],
        }),
      });
      if (claudeRes.ok) break;
      throw new Error(`Claude HTTP ${claudeRes.status}`);
    } catch (e) {
      claudeErr = e;
      console.error('[status] Claude attempt', attempt + 1, 'failed:', e);
      if (attempt === 0) await new Promise(r => setTimeout(r, 3000));
    }
  }
  if (!claudeRes || !claudeRes.ok) {
    const errMsg = claudeErr?.message || 'Claude failed after 2 attempts';
    const updated = { ...job, status: "error", error: errMsg };
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
    url: job.url,
    episodeTitle: job.episodeTitle || "Podcast Episode",
    showName: job.showName || "",
    duration: audioDuration
      ? `${Math.round(audioDuration / 60)} min`
      : "Unknown",
    ...analysis,
    guest: analysis.guest || null,
  };

  await store.setJSON(jobId, result);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = {
  path: "/api/status/:jobId",
  timeout: 300,
};
