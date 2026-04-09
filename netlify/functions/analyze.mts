import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { url } = await req.json();
  if (!url) {
    return new Response(JSON.stringify({ error: "URL is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const assemblyKey = Netlify.env.get("ASSEMBLYAI_API_KEY");
  let audioUrl = url;
  let episodeTitle = "Podcast Episode";
  let showName = "";

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

  const store = getStore("podlens-jobs");
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
