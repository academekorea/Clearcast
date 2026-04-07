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
  let episodeTitle = "Podcast episode";
  let showName = "";

  // If it's an RSS feed, extract the first episode's audio URL
  if (url.includes("rss") || url.includes("feed") || url.endsWith(".xml")) {
    try {
      const rssRes = await fetch(url);
      const rssText = await rssRes.text();
      const match = rssText.match(/<enclosure[^>]+url="([^"]+)"/i);
      if (match) {
        audioUrl = match[1];
      } else {
        return new Response(JSON.stringify({ error: "Could not find audio in RSS feed" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      const titleMatch = rssText.match(/<item[^>]*>[\s\S]*?<title><!\[CDATA\[(.*?)\]\]>/i)
        || rssText.match(/<item[^>]*>[\s\S]*?<title>(.*?)<\/title>/i);
      if (titleMatch) episodeTitle = titleMatch[1].trim();
      const showTitleMatch = rssText.match(/<channel[^>]*>[\s\S]*?<title><!\[CDATA\[(.*?)\]\]>/i)
        || rssText.match(/<channel[^>]*>[\s\S]*?<title>(.*?)<\/title>/i);
      if (showTitleMatch) showName = showTitleMatch[1].trim();
    } catch {
      return new Response(JSON.stringify({ error: "Failed to parse RSS feed" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Submit to AssemblyAI
  const aaiRes = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: {
      authorization: assemblyKey!,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      auto_chapters: true,
      speech_models: ["universal-2"],
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
  const transcriptId = aaiData.id;
  const jobId = transcriptId;

  // Store job in Netlify Blobs
  const store = getStore("podlens-jobs");
  await store.setJSON(jobId, {
    status: "transcribing",
    transcriptId,
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
