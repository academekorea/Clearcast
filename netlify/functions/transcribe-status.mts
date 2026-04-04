import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export default async (req: Request) => {
  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");

  if (!jobId) {
    return new Response(JSON.stringify({ error: "jobId is required" }), {
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

    // Already resolved — return cached result
    if (job.status === "transcribed") {
      return new Response(JSON.stringify({ status: "complete", jobId }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    if (job.status === "error") {
      return new Response(JSON.stringify({ status: "error", error: job.error, jobId }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // Poll AssemblyAI
    const assemblyKey = Netlify.env.get("ASSEMBLYAI_API_KEY");
    const aaiRes = await fetch(`https://api.assemblyai.com/v2/transcript/${job.transcriptId}`, {
      headers: { "authorization": assemblyKey! },
    });
    const transcript = await aaiRes.json();

    if (transcript.status === "error") {
      const updated = { ...job, status: "error", error: transcript.error || "Transcription failed" };
      await store.setJSON(jobId, updated);
      return new Response(JSON.stringify({ status: "error", error: updated.error, jobId }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    if (transcript.status === "completed") {
      // Store as "transcribed" so /api/status/:jobId can run Claude analysis on it
      const updated = {
        ...job,
        status: "transcribed",
        transcript: transcript.text,
        duration: transcript.audio_duration
          ? `${Math.round(transcript.audio_duration / 60)} min`
          : "",
      };
      await store.setJSON(jobId, updated);
      return new Response(JSON.stringify({ status: "complete", jobId }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ status: "transcribing", jobId }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ status: "error", error: e?.message || "Unknown error" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/transcribe/status" };
