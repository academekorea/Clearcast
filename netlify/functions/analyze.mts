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

  // If not a direct audio file, try to parse as RSS
  const isDirectAudio = url.match(/\.(mp3|m4a|ogg|wav|aac)(\?|$)/i);
  if (!isDirectAudio) {
    try {
      const rssRes = await fetch(url, {
        headers: { "User-Agent": "Clearcast/1.0" }
      });
      const rssText = await rssRes.text();
      const patterns = [
        /<enclosure[^>]+url="([^"]+)"/i,
        /<enclosure[^>]+url='([^']+)'/i,
        /url="([^"]+\.mp3[^"]*)"/i,
        /url="([^"]+\.m4a[^"]*)"/i,
        /<media:content[^>]+url="([^"]+)"/i,
      ];
      let found = false;
      for (const pattern of patterns) {
        const match = rssText.match(pattern);
        if (match) {
          audioUrl = match[1].replace(/&amp;/g, "&");
          found = true;
          break;
        }
      }
      if (!found) {
        return new Response(JSON.stringify({ error: "Could not find audio in RSS feed. Try pasting a direct MP3 URL instead." }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
    } catch {
      return new Response(JSON.stringify({ error: "Failed to fetch RSS feed. Try a direct MP3 URL instead." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Submit to AssemblyAI v2
  const aaiRes = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: {
      "authorization": assemblyKey!,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      audio_url: audioUrl,
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

  // Store job
  const store = getStore("clearcast-jobs");
  await store.setJSON(transcriptId, {
    status: "transcribing",
    transcriptId,
    url,
    createdAt: Date.now(),
  });

  return new Response(JSON.stringify({ jobId: transcriptId, status: "transcribing" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = {
  path: "/api/analyze",
};
