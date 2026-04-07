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

  if (url.includes("rss") || url.includes("feed") || url.endsWith(".xml")) {
    try {
      const rssRes = await fetch(url);
      const rssText = await rssRes.text();

      const audioMatch = rssText.match(/<enclosure[^>]+url="([^"]+)"/i);
      if (!audioMatch) {
        return new Response(JSON.stringify({ error: "Could not find audio in RSS feed" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      audioUrl = audioMatch[1];

      const showMatch = rssText.match(/<channel[^>]*>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i);
      if (showMatch) showName = showMatch[1].trim();

      const epMatch = rssText.match(/<item[^>]*>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i);
      if (epMatch) episodeTitle = epMatch[1].trim();

    } catch {
      return new Response(JSON.stringify({ error: "Failed to parse RSS feed" }), {
        status: 400,
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
