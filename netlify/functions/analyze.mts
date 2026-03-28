import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

async function extractAudioUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Clearcast/1.0)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      }
    });
    const text = await res.text();
    const patterns = [
      /["'](https?:\/\/[^"']+\.mp3[^"']*?)["']/i,
      /["'](https?:\/\/[^"']+\.m4a[^"']*?)["']/i,
      /"audio_url"\s*:\s*"([^"]+)"/i,
      /content="(https?:\/\/[^"]+\.mp3[^"]*)"/i,
      /<enclosure[^>]+url="([^"]+)"/i,
      /url="([^"]+\.mp3[^"]*)"/i,
      /src="(https?:\/\/[^"]+\.mp3[^"]*)"/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1].replace(/&amp;/g, "&");
    }
    const buzzsproutMatch = url.match(/buzzsprout\.com\/(\d+)/);
    if (buzzsproutMatch) {
      const showId = buzzsproutMatch[1];
      const rssRes = await fetch(`https://feeds.buzzsprout.com/${showId}.rss`, {
        headers: { "User-Agent": "Clearcast/1.0" }
      });
      const rssText = await rssRes.text();
      const enclosure = rssText.match(/<enclosure[^>]+url="([^"]+)"/i);
      if (enclosure) return enclosure[1].replace(/&amp;/g, "&");
    }
    return null;
  } catch {
    return null;
  }
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const { url } = await req.json();
  if (!url) {
    return new Response(JSON.stringify({ error: "URL is required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  const assemblyKey = Netlify.env.get("ASSEMBLYAI_API_KEY");
  let audioUrl = url;
  const isDirectAudio = url.match(/\.(mp3|m4a|ogg|wav|aac)(\?|$)/i);
  if (!isDirectAudio) {
    const extracted = await extractAudioUrl(url);
    if (!extracted) {
      return new Response(JSON.stringify({
        error: "Could not find audio. Try a direct MP3 link or RSS feed URL."
      }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    audioUrl = extracted;
  }
  const aaiRes = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: {
      "authorization": assemblyKey!,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      speech_models: ["universal-2"],
    }),
  });
  if (!aaiRes.ok) {
    const err = await aaiRes.text();
    return new Response(JSON.stringify({ error: "AssemblyAI: " + err }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  const aaiData = await aaiRes.json();
  const transcriptId = aaiData.id;
  const store = getStore("clearcast-jobs");
  await store.setJSON(transcriptId, {
    status: "transcribing", transcriptId, url, audioUrl, createdAt: Date.now(),
  });
  return new Response(JSON.stringify({ jobId: transcriptId, status: "transcribing" }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = { path: "/api/analyze" };
