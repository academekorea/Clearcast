import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

async function transcribeInBackground(
  jobId: string,
  youtubeUrl: string,
  store: ReturnType<typeof getStore>
): Promise<void> {
  const audioServiceUrl = Netlify.env.get("AUDIO_SERVICE_URL");
  const secret = Netlify.env.get("YOUTUBE_SERVICE_SECRET");

  console.log('[analyze] transcribeInBackground start, jobId:', jobId, 'audioServiceUrl:', audioServiceUrl);

  const result = await fetch(`${audioServiceUrl}/extract`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${secret}`,
    },
    body: JSON.stringify({ url: youtubeUrl }),
    signal: AbortSignal.timeout(300000),
  }).then((r) => r.json());

  console.log('[analyze] Railway extract result:', result.success, 'method:', result.method);

  if (result.success && result.transcript) {
    // Captions path — save transcript directly, status.mts will run Claude analysis
    await store.setJSON(jobId, {
      status: "transcribed",
      jobId,
      url: youtubeUrl,
      transcript: result.transcript,
      metadata: result.metadata || {},
    });
    console.log('[analyze] transcript saved for jobId:', jobId);
  } else if (result.success && result.audioData) {
    // Audio path — upload to AssemblyAI and save transcript
    const assemblyKey = Netlify.env.get("ASSEMBLYAI_API_KEY");
    const audioBuffer = Buffer.from(result.audioData, "base64");

    const uploadRes = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: { "authorization": assemblyKey! },
      body: audioBuffer,
    });
    if (!uploadRes.ok) throw new Error("AssemblyAI upload failed");
    const { upload_url } = await uploadRes.json();

    const transcriptRes = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: { "authorization": assemblyKey!, "content-type": "application/json" },
      body: JSON.stringify({ audio_url: upload_url }),
    });
    if (!transcriptRes.ok) throw new Error("AssemblyAI transcript submission failed");
    const { id: transcriptId } = await transcriptRes.json();

    // Poll until complete
    while (true) {
      await new Promise((r) => setTimeout(r, 5000));
      const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: { "authorization": assemblyKey! },
      }).then((r) => r.json());

      if (poll.status === "completed") {
        const duration = result.metadata?.duration
          ? `${Math.round(result.metadata.duration / 60)} min` : "";
        await store.setJSON(jobId, {
          status: "transcribed",
          jobId,
          url: youtubeUrl,
          transcript: poll.text,
          duration,
          metadata: result.metadata || {},
        });
        console.log('[analyze] audio transcript saved for jobId:', jobId);
        return;
      }
      if (poll.status === "error") {
        throw new Error("AssemblyAI transcription error: " + poll.error);
      }
    }
  } else {
    const errMsg = result.error || "Railway extraction failed";
    console.error('[analyze] Railway failed:', errMsg);
    await store.setJSON(jobId, { status: "error", jobId, error: errMsg });
  }
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await req.json();
  const { url, episodeTitle: epTitleRaw, showName: showNameRaw } = body;
  if (!url) {
    return new Response(JSON.stringify({ error: "URL is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const assemblyKey = Netlify.env.get("ASSEMBLYAI_API_KEY");
  const audioUrl = url;
  const episodeTitle = epTitleRaw || "";
  const showName = showNameRaw || "";

  const store = getStore("podlens-jobs");

  // YouTube: call Railway inline — self-referential HTTP was silently failing
  const isYouTube = /(?:youtube\.com\/watch\?|youtu\.be\/)/.test(url);
  if (isYouTube) {
    const jobId = `yt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await store.setJSON(jobId, {
      status: "pending",
      jobId,
      url,
      episodeTitle: episodeTitle || "",
      showName: showName || "",
    });
    console.log('[analyze] YouTube detected, starting inline transcription for jobId:', jobId);
    transcribeInBackground(jobId, url, store).catch((err) =>
      console.error('[analyze] background failed:', err.message)
    );
    return new Response(JSON.stringify({ jobId }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const aaiRes = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: {
      authorization: assemblyKey!,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      speech_models: ["universal-2"],
      auto_chapters: true,
    }),
  });

  if (!aaiRes.ok) {
    const err = await aaiRes.text();
    return new Response(JSON.stringify({ error: "AssemblyAI error: " + err }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const aaiData = await aaiRes.json();
  const jobId = aaiData.id;

  await store.setJSON(jobId, {
    status: "transcribing",
    transcriptId: jobId,
    url,
    episodeTitle,
    showName,
    createdAt: Date.now(),
  });

  return new Response(JSON.stringify({ jobId, status: "transcribing" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = {
  path: "/api/analyze",
};
