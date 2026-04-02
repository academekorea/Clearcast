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

// Fetch YouTube captions via the timedtext API (no auth required for public videos)
async function getYouTubeTranscript(videoId: string): Promise<{ text: string; duration: string } | null> {
  const tryFetch = async (url: string) => {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const data = await res.json() as any;
      const events: any[] = data.events || [];
      if (events.length === 0) return null;
      const text = events
        .filter((e) => e.segs)
        .map((e) => e.segs.map((s: any) => s.utf8 || "").join(""))
        .join(" ")
        .replace(/\n/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!text || text.length < 100) return null;
      const last = events[events.length - 1];
      const totalMs = (last?.tStartMs || 0) + (last?.dDurationMs || 0);
      const duration = totalMs > 0 ? `${Math.round(totalMs / 60000)} min` : "";
      return { text, duration };
    } catch {
      return null;
    }
  };

  // Try manual English captions first, then auto-generated
  return (
    await tryFetch(`https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`) ||
    await tryFetch(`https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&kind=asr&fmt=json3`) ||
    await tryFetch(`https://www.youtube.com/api/timedtext?v=${videoId}&lang=en-US&fmt=json3`) ||
    null
  );
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

    const store = getStore("clearcast-jobs");

    // YouTube: use captions instead of AssemblyAI (faster, no audio extraction needed)
    const ytMatch = url.match(/(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) {
      const cap = await getYouTubeTranscript(ytMatch[1]);
      if (!cap) {
        return new Response(JSON.stringify({
          error: "No captions found for this YouTube video. Try a video that has auto-generated or manual captions enabled.",
        }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      const jobId = `yt-${ytMatch[1]}-${Date.now()}`;
      await store.setJSON(jobId, {
        status: "transcribed",
        jobId,
        url,
        transcript: cap.text,
        duration: cap.duration,
        createdAt: Date.now(),
        showName: showName || null,
        showSlug: showSlug || null,
        showArtwork: showArtwork || null,
        showFeedUrl: showFeedUrl || null,
      });
      return new Response(JSON.stringify({ jobId, status: "transcribed" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // Non-YouTube: extract audio URL then send to AssemblyAI
    const assemblyKey = Netlify.env.get("ASSEMBLYAI_API_KEY");
    if (!assemblyKey) {
      return new Response(JSON.stringify({ error: "Transcription service not configured" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    let audioUrl = url;
    if (!url.match(/\.(mp3|m4a|ogg|wav|aac)(\?|$)/i)) {
      const extracted = await extractAudioUrl(url);
      if (extracted) {
        audioUrl = extracted;
      } else if (!isAudioUrl(url)) {
        return new Response(JSON.stringify({
          error: "Could not find audio. Please paste a YouTube URL, direct MP3/M4A link, or RSS feed URL.",
        }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
    }

    const aaiRes = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: { "authorization": assemblyKey, "content-type": "application/json" },
      body: JSON.stringify({ audio_url: audioUrl, speech_models: ["universal-3-pro"] }),
    });

    if (!aaiRes.ok) {
      const errText = await aaiRes.text();
      console.error("AssemblyAI error:", errText);
      let errMsg = "Transcription service error. Please try again.";
      try { const j = JSON.parse(errText); if (j.error) errMsg = j.error; } catch { /**/ }
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
