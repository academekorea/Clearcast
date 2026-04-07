import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

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

  if (job.status === "analyzing") {
    return new Response(JSON.stringify({ status: "analyzing", jobId }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

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

  await store.setJSON(jobId, { ...job, status: "analyzing" });

  const baseUrl = new URL(req.url).origin;
  fetch(`${baseUrl}/api/run-analysis`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jobId,
      transcriptText: transcript.text,
      episodeTitle: job.episodeTitle || "Podcast Episode",
      showName: job.showName || "",
      audioUrl: job.url,
      audioDuration: transcript.audio_duration,
    }),
  }).catch(() => {});

  return new Response(JSON.stringify({ status: "analyzing", jobId }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = {
  path: "/api/status/:jobId",
  timeout: 30,
};
