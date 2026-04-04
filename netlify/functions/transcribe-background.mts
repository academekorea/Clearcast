import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async (req: Request) => {
  const store = getStore("transcripts");

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
    await store.setJSON(jobId, { status: "error", message: "Server configuration error: missing env vars" });
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  // Step 1: Mark as processing
  await store.setJSON(jobId, { status: "processing" });

  try {
    // Step 2: Fetch audio from the audio service
    const audioRes = await fetch(`${audioServiceUrl}/audio?url=${encodeURIComponent(youtubeUrl)}`);
    if (!audioRes.ok) {
      const msg = `Audio service error: ${audioRes.status}`;
      await store.setJSON(jobId, { status: "error", message: msg });
      return new Response(JSON.stringify({ error: msg }), {
        status: 502, headers: { "Content-Type": "application/json" },
      });
    }
    const audioBuffer = await audioRes.arrayBuffer();

    // Step 3: Upload audio buffer to AssemblyAI
    const uploadRes = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: { "authorization": assemblyKey },
      body: audioBuffer,
    });
    if (!uploadRes.ok) {
      const msg = "Failed to upload audio to transcription service";
      await store.setJSON(jobId, { status: "error", message: msg });
      return new Response(JSON.stringify({ error: msg }), {
        status: 502, headers: { "Content-Type": "application/json" },
      });
    }
    const { upload_url } = await uploadRes.json();

    // Step 4: Submit transcript job
    const transcriptRes = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: { "authorization": assemblyKey, "content-type": "application/json" },
      body: JSON.stringify({ audio_url: upload_url }),
    });
    if (!transcriptRes.ok) {
      const msg = "Failed to start transcription job";
      await store.setJSON(jobId, { status: "error", message: msg });
      return new Response(JSON.stringify({ error: msg }), {
        status: 502, headers: { "Content-Type": "application/json" },
      });
    }
    const { id: transcriptId } = await transcriptRes.json();

    // Step 5: Poll until completed or error
    while (true) {
      await sleep(5000);
      const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: { "authorization": assemblyKey },
      });
      const poll = await pollRes.json();

      if (poll.status === "completed") {
        // Step 6: Save complete transcript
        await store.setJSON(jobId, { status: "complete", transcript: poll.text });
        return new Response(JSON.stringify({ status: "complete" }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }

      if (poll.status === "error") {
        // Step 7: Save error
        const message = poll.error || "Transcription failed";
        await store.setJSON(jobId, { status: "error", message });
        return new Response(JSON.stringify({ status: "error", message }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
    }
  } catch (e: any) {
    const message = e?.message || "Unknown error";
    await store.setJSON(jobId, { status: "error", message });
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = {
  path: "/api/transcribe/background",
};
