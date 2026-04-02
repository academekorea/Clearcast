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

async function getYouTubeAudioUrl(videoId: string): Promise<string | null> {
  try {
    const res = await fetch("https://www.youtube.com/youtubei/v1/player", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "com.google.android.youtube/17.31.35 (Linux; U; Android 11)",
        "X-YouTube-Client-Name": "3",
        "X-YouTube-Client-Version": "17.31.35",
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: "17.31.35",
            androidSdkVersion: 30,
            hl: "en",
            gl: "US",
          },
        },
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    const formats: any[] = [
      ...(data?.streamingData?.adaptiveFormats || []),
      ...(data?.streamingData?.formats || []),
    ];
    // Prefer m4a audio-only, fall back to any audio
    const audio = formats.find((f) => f.mimeType?.startsWith("audio/mp4"))
      || formats.find((f) => f.mimeType?.startsWith("audio/"));
    return audio?.url || null;
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
    const { url, showName, showSlug, showArtwork, showFeedUrl } = body;

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

    const ytMatch = url.match(/(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    const isYouTube = !!ytMatch;

    if (isYouTube && ytMatch) {
      const ytAudio = await getYouTubeAudioUrl(ytMatch[1]);
      if (!ytAudio) {
        return new Response(JSON.stringify({
          error: "Could not extract audio from this YouTube video. Make sure it's a public video and try again."
        }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      audioUrl = ytAudio;
    } else if (!url.match(/\.(mp3|m4a|ogg|wav|aac)(\?|$)/i)) {
      const extracted = await extractAudioUrl(url);
      if (extracted) {
        audioUrl = extracted;
      } else if (!isAudioUrl(url)) {
        return new Response(JSON.stringify({
          error: "Could not find audio. Please paste a YouTube URL, direct MP3/M4A link, or RSS feed URL."
        }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      // isAudioUrl matched (CDN/podcast URL pattern) — try the URL directly with AssemblyAI
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
        speech_models: ["universal-3-pro"],
      }),
    });

    if (!aaiRes.ok) {
      const errText = await aaiRes.text();
      console.error("AssemblyAI error:", errText);
      let errMsg = "Transcription service error. Please try again.";
      try {
        const errJson = JSON.parse(errText);
        if (errJson.error) errMsg = errJson.error;
      } catch { /* keep default message */ }
      return new Response(JSON.stringify({ error: errMsg }), {
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
      showName: showName || null,
      showSlug: showSlug || null,
      showArtwork: showArtwork || null,
      showFeedUrl: showFeedUrl || null,
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
