import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

async function extractAudioUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Clearcast/1.0)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    const patterns = [
      /<enclosure[^>]+url="([^"]+)"/i,
      /["'](https?:\/\/[^"']+\.mp3[^"']*?)["']/i,
      /["'](https?:\/\/[^"']+\.m4a[^"']*?)["']/i,
      /["'](https?:\/\/[^"']+\.ogg[^"']*?)["']/i,
      /"audio_url"\s*:\s*"([^"]+)"/i,
      /content="(https?:\/\/[^"]+\.mp3[^"]*)"/i,
      /url="([^"]+\.mp3[^"]*)"/i,
      /src="(https?:\/\/[^"]+\.mp3[^"]*)"/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1].replace(/&amp;/g, "&");
    }
    return null;
  } catch {
    return null;
  }
}

function isAudioUrl(url: string): boolean {
  return !!(
    url.match(/\.(mp3|m4a|ogg|wav|aac)(\?|$)/i) ||
    url.includes("audio") ||
    url.includes("media") ||
    url.includes("cdn") ||
    url.includes("podcast") ||
    url.includes("episode") ||
    url.match(/\/(e|ep|episodes?)\//i)
  );
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json();
    const { url } = body;

    if (!url) {
      return new Response(JSON.stringify({ error: "URL is required" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const assemblyKey = Netlify.env.get("ASSEMBLYAI_API_KEY");
    if (!assemblyKey) {
      return new Response(JSON.stringify({ error: "Transcription service not configured" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    let audioUrl = url;

    // If it doesn't look like a direct audio file, try to extract audio URL
    if (!url.match(/\.(mp3|m4a|ogg|wav|aac)(\?|$)/i)) {
      const extracted = await extractAudioUrl(url);
      if (extracted) {
        audioUrl = extracted;
      } else if (!isAudioUrl(url)) {
        return new Response(JSON.stringify({
          error: "Could not find audio. Please paste a direct MP3 link or RSS feed URL."
        }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      // If isAudioUrl but no extension matched, try the URL directly
    }

    // Submit to AssemblyAI v2
    const aaiRes = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: {
        "authorization": assemblyKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        audio_url: audioUrl,
        speech_model: "best",
      }),
    });

    if (!aaiRes.ok) {
      const err = await aaiRes.text();
      console.error("AssemblyAI error:", err);
      return new Response(JSON.stringify({ error: "Transcription service error. Please try again." }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    const aaiData = await aaiRes.json();
    const transcriptId = aaiData.id;

    if (!transcriptId) {
      return new Response(JSON.stringify({ error: "Failed to start transcription. Please try again." }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    const store = getStore("clearcast-jobs");
    await store.setJSON(transcriptId, {
      status: "transcribing",
      transcriptId,
      url,
      audioUrl,
      createdAt: Date.now(),
    });

    return new Response(JSON.stringify({ jobId: transcriptId, status: "transcribing" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });

  } catch (e: any) {
    console.error("Analyze error:", e);
    return new Response(JSON.stringify({ error: "Server error: " + (e?.message || "Unknown error") }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/analyze" };
