import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { uploadAndTranscribe } from "./lib/assemblyai.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractVideoId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

export default async (req: Request) => {
  const transcripts = getStore("transcripts");
  const cache = getStore("transcript-cache");
  const jobs = getStore("podlens-jobs");

  let jobId: string;
  let youtubeUrl: string;

  try {
    ({ jobId, youtubeUrl } = await req.json());
    if (!jobId || !youtubeUrl) throw new Error("Missing jobId or youtubeUrl");
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const audioServiceUrl = Netlify.env.get("AUDIO_SERVICE_URL");
  const assemblyKey = Netlify.env.get("ASSEMBLYAI_API_KEY");

  if (!audioServiceUrl || !assemblyKey) {
    const msg = "Server configuration error: missing env vars";
    await transcripts.setJSON(jobId, { status: "error", message: msg });
    await jobs.setJSON(jobId, { status: "error", error: msg });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  // ── Result caching — skip re-transcription if we've done this video before ──
  const videoId = extractVideoId(youtubeUrl);
  if (videoId) {
    try {
      const cached = await cache.get(videoId, { type: "json" }) as any;
      if (cached?.transcript && cached.createdAt && Date.now() - cached.createdAt < SEVEN_DAYS_MS) {
        await transcripts.setJSON(jobId, { status: "complete", transcript: cached.transcript });
        await jobs.setJSON(jobId, { status: "transcribed", transcript: cached.transcript, duration: cached.duration || "" });
        return new Response(JSON.stringify({ status: "complete", cached: true }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
    } catch { /* cache miss — continue */ }
  }

  // Step 1: Mark as processing
  await transcripts.setJSON(jobId, { status: "processing" });
  await jobs.setJSON(jobId, { status: "transcribing" });

  try {
    // ── Railway health check — wake service if sleeping (cold start) ──
    const healthOk = await (async () => {
      try {
        const h = await fetch(`${audioServiceUrl}/health`, { signal: AbortSignal.timeout(10000) });
        return h.ok;
      } catch { return false; }
    })();

    if (!healthOk) {
      // Wait 15 s for Railway cold start, then retry once
      await sleep(15000);
      try {
        const h = await fetch(`${audioServiceUrl}/health`, { signal: AbortSignal.timeout(10000) });
        if (!h.ok) throw new Error("Audio service unavailable after cold-start wait");
      } catch (e: any) {
        const msg = "Audio extraction service is unavailable. Please try again in a minute.";
        await transcripts.setJSON(jobId, { status: "error", message: msg });
        await jobs.setJSON(jobId, { status: "error", error: msg });
        return new Response(JSON.stringify({ error: msg }), {
          status: 502, headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Step 2: Extract via Railway POST /extract (captions first, audio fallback)
    const youtubeSecret = Netlify.env.get("YOUTUBE_SERVICE_SECRET");
    const extractRes = await fetch(`${audioServiceUrl}/extract`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(youtubeSecret ? { "Authorization": `Bearer ${youtubeSecret}` } : {}),
      },
      body: JSON.stringify({ url: youtubeUrl }),
      signal: AbortSignal.timeout(90000),
    });
    if (!extractRes.ok) {
      const msg = "AUDIO_EXTRACTION_FAILED";
      await transcripts.setJSON(jobId, { status: "error", message: msg });
      await jobs.setJSON(jobId, { status: "error", error: msg, code: "AUDIO_EXTRACTION_FAILED" });
      return new Response(JSON.stringify({ error: msg }), {
        status: 502, headers: { "Content-Type": "application/json" },
      });
    }

    const extractData = await extractRes.json();
    if (!extractData.success) {
      const msg = extractData.error || "AUDIO_EXTRACTION_FAILED";
      const code = extractData.code || "AUDIO_EXTRACTION_FAILED";
      await transcripts.setJSON(jobId, { status: "error", message: msg });
      await jobs.setJSON(jobId, { status: "error", error: msg, code });
      return new Response(JSON.stringify({ error: msg }), {
        status: 502, headers: { "Content-Type": "application/json" },
      });
    }

    // Fast path: captions returned — skip AssemblyAI entirely
    if (extractData.method === "captions" && extractData.transcript) {
      const duration = extractData.metadata?.duration
        ? `${Math.round(extractData.metadata.duration / 60)} min` : "";
      await transcripts.setJSON(jobId, { status: "complete", transcript: extractData.transcript });
      await jobs.setJSON(jobId, { status: "transcribed", transcript: extractData.transcript, duration });
      if (videoId) {
        await cache.setJSON(videoId, { transcript: extractData.transcript, duration, createdAt: Date.now() });
      }
      return new Response(JSON.stringify({ status: "complete", method: "captions" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // Audio path: decode base64 MP3 and upload to AssemblyAI
    if (!extractData.audioData) {
      const msg = "No audio data returned from extraction service";
      await transcripts.setJSON(jobId, { status: "error", message: msg });
      await jobs.setJSON(jobId, { status: "error", error: msg });
      return new Response(JSON.stringify({ error: msg }), {
        status: 502, headers: { "Content-Type": "application/json" },
      });
    }
    const audioBuffer = Buffer.from(extractData.audioData, "base64");

    // Step 3+4: Upload audio buffer to AssemblyAI and submit transcript job
    let transcriptId: string;
    try {
      const aaiResult = await uploadAndTranscribe(assemblyKey, audioBuffer);
      transcriptId = aaiResult.id;
    } catch (e: any) {
      const msg = e.message || "Failed to start transcription job";
      await transcripts.setJSON(jobId, { status: "error", message: msg });
      await jobs.setJSON(jobId, { status: "error", error: msg });
      return new Response(JSON.stringify({ error: msg }), {
        status: 502, headers: { "Content-Type": "application/json" },
      });
    }

    // Step 5: Poll until completed or error
    while (true) {
      await sleep(5000);
      const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: { "authorization": assemblyKey },
      });
      const poll = await pollRes.json();

      if (poll.status === "completed") {
        const duration = poll.audio_duration ? `${Math.round(poll.audio_duration / 60)} min` : "";

        // Step 6: Save job result
        await transcripts.setJSON(jobId, { status: "complete", transcript: poll.text });
        await jobs.setJSON(jobId, { status: "transcribed", transcript: poll.text, duration });

        // Save to cache (keyed by videoId) to avoid re-transcribing same video
        if (videoId) {
          await cache.setJSON(videoId, { transcript: poll.text, duration, createdAt: Date.now() });
        }

        return new Response(JSON.stringify({ status: "complete" }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }

      if (poll.status === "error") {
        // Step 7: Save error
        const message = poll.error || "Transcription failed";
        await transcripts.setJSON(jobId, { status: "error", message });
        await jobs.setJSON(jobId, { status: "error", error: message });
        return new Response(JSON.stringify({ status: "error", message }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
    }
  } catch (e: any) {
    const message = e?.message || "Unknown error";
    await transcripts.setJSON(jobId, { status: "error", message });
    await jobs.setJSON(jobId, { status: "error", error: message });
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = {
  path: "/api/transcribe/background",
};
