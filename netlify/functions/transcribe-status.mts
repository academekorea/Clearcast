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
    const jobs = getStore("clearcast-jobs");
    const transcripts = getStore("transcripts");

    // Check clearcast-jobs first (transcribe-start path + background function updates)
    let job = await jobs.get(jobId, { type: "json" }).catch(() => null) as any;

    // Fall back to the "transcripts" store (written directly by transcribe-background)
    if (!job) {
      const bgJob = await transcripts.get(jobId, { type: "json" }).catch(() => null) as any;
      if (bgJob) {
        // Normalise to the same shape expected by the frontend
        if (bgJob.status === "complete") {
          return new Response(JSON.stringify({ status: "complete", jobId }), {
            status: 200, headers: { "Content-Type": "application/json" },
          });
        }
        if (bgJob.status === "error") {
          return new Response(JSON.stringify({ status: "error", error: bgJob.message, code: bgJob.code, jobId }), {
            status: 200, headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ status: "transcribing", jobId }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }

    // Already resolved in clearcast-jobs
    if (job.status === "transcribed") {
      return new Response(JSON.stringify({ status: "complete", jobId }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    if (job.status === "error") {
      return new Response(JSON.stringify({ status: "error", error: job.error, code: job.code, jobId }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // Still transcribing via AssemblyAI — poll it directly
    if (!job.transcriptId) {
      // Background function is running — just report transcribing
      return new Response(JSON.stringify({ status: "transcribing", jobId }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    const assemblyKey = Netlify.env.get("ASSEMBLYAI_API_KEY");
    const aaiRes = await fetch(`https://api.assemblyai.com/v2/transcript/${job.transcriptId}`, {
      headers: { "authorization": assemblyKey! },
    });
    const transcript = await aaiRes.json();

    if (transcript.status === "error") {
      const updated = { ...job, status: "error", error: transcript.error || "Transcription failed" };
      await jobs.setJSON(jobId, updated);
      return new Response(JSON.stringify({ status: "error", error: updated.error, jobId }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    if (transcript.status === "completed") {
      const updated = {
        ...job,
        status: "transcribed",
        transcript: transcript.text,
        duration: transcript.audio_duration ? `${Math.round(transcript.audio_duration / 60)} min` : "",
      };
      await jobs.setJSON(jobId, updated);
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
