import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export default async (req: Request, context: Context) => {
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

  const isYouTube = /(?:youtube\.com\/(?:watch\?|shorts\/|embed\/|v\/)|youtu\.be\/|m\.youtube\.com\/watch)/.test(url);

  if (isYouTube) {
    try {
      console.log('[analyze] YouTube branch entered, url:', url);
      const jobId = `yt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      console.log('[analyze] saving pending blob, jobId:', jobId);
      await store.setJSON(jobId, {
        status: "pending",
        jobId,
        url,
        episodeTitle: episodeTitle || "",
        showName: showName || "",
      });
      console.log('[analyze] blob saved');

      const audioServiceUrl = Netlify.env.get("AUDIO_SERVICE_URL");
      const secret = Netlify.env.get("YOUTUBE_SERVICE_SECRET");

      console.log('[analyze] AUDIO_SERVICE_URL:', audioServiceUrl);

      // Use context.waitUntil so Netlify keeps the function alive until Railway responds
      const railwayWork = (async () => {
        try {
          if (!audioServiceUrl) {
            console.error('[analyze] AUDIO_SERVICE_URL not set');
            await store.setJSON(jobId, {
              status: "error",
              jobId,
              error: "AUDIO_SERVICE_URL not set in environment",
              audioServiceUrl: "NOT_SET",
              timestamp: new Date().toISOString(),
            });
            return;
          }
          console.log('[analyze] calling Railway at:', audioServiceUrl + '/extract');
          const extractRes = await fetch(`${audioServiceUrl}/extract`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${secret}`,
            },
            body: JSON.stringify({ url }),
            signal: AbortSignal.timeout(300000),
          });
          console.log('[analyze] Railway status:', extractRes.status);
          const extracted = await extractRes.json();
          console.log('[analyze] Railway response:', extracted.success, extracted.method);

          if (extracted.success && extracted.transcript) {
            await store.setJSON(jobId, {
              status: "transcribed",
              jobId,
              url,
              episodeTitle: episodeTitle || extracted.metadata?.title || "",
              showName: showName || extracted.metadata?.channelTitle || "",
              transcript: extracted.transcript,
            });
          } else if (extracted.success && extracted.audioData) {
            // Upload audio to AssemblyAI
            const uploadRes = await fetch("https://api.assemblyai.com/v2/upload", {
              method: "POST",
              headers: {
                "authorization": Netlify.env.get("ASSEMBLYAI_API_KEY") || "",
                "content-type": "application/octet-stream",
              },
              body: Buffer.from(extracted.audioData, "base64"),
            });
            const { upload_url } = await uploadRes.json();

            const transcriptRes = await fetch("https://api.assemblyai.com/v2/transcript", {
              method: "POST",
              headers: {
                "authorization": Netlify.env.get("ASSEMBLYAI_API_KEY") || "",
                "content-type": "application/json",
              },
              body: JSON.stringify({ audio_url: upload_url }),
            });
            const { id: transcriptId } = await transcriptRes.json();

            await store.setJSON(jobId, {
              status: "transcribing",
              jobId,
              url,
              episodeTitle: episodeTitle || extracted.metadata?.title || "",
              showName: showName || "",
              transcriptId,
            });
          } else {
            console.error('[analyze] Railway returned no usable data:', JSON.stringify(extracted));
            await store.setJSON(jobId, {
              status: "error",
              jobId,
              error: extracted.error || "Railway returned no transcript or audio",
            });
          }
        } catch (err: any) {
          console.error('[analyze] Railway fetch threw:', err.message, err.stack);
          await store.setJSON(jobId, {
            status: "error",
            jobId,
            error: String(err),
            errorDetail: err.message || "",
            audioServiceUrl: audioServiceUrl || "NOT_SET",
            timestamp: new Date().toISOString(),
          });
        }
      })();

      context.waitUntil(railwayWork);

      console.log('[analyze] returning jobId:', jobId);
      return new Response(JSON.stringify({ jobId }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      console.error('[analyze] YouTube branch crashed:', err.message, err.stack);
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
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
