import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

async function getYouTubeAudioUrl(videoId: string): Promise<string | null> {
  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Cookie": "CONSENT=YES+cb.20210328-17-p0.en+FX+999; SOCS=CAESEwgDEgk2MDIzMDEwMRoCZW4gAQ==",
      },
      signal: AbortSignal.timeout(15000),
    });
    const html = await pageRes.text();

    const marker = "ytInitialPlayerResponse = ";
    const markerIdx = html.indexOf(marker);
    if (markerIdx === -1) return null;

    const jsonStart = markerIdx + marker.length;
    let depth = 0, jsonEnd = -1;
    for (let i = jsonStart; i < Math.min(jsonStart + 600000, html.length); i++) {
      if (html[i] === "{") depth++;
      else if (html[i] === "}") { depth--; if (depth === 0) { jsonEnd = i; break; } }
    }
    if (jsonEnd === -1) return null;

    const pr = JSON.parse(html.slice(jsonStart, jsonEnd + 1));
    const formats: any[] = [
      ...(pr?.streamingData?.adaptiveFormats || []),
      ...(pr?.streamingData?.formats || []),
    ];

    // Only formats with a plain url (no signatureCipher) are usable without JS decipher
    const audioFormats = formats.filter((f) =>
      f.url && (f.mimeType?.startsWith("audio/") || (f.audioQuality && !f.qualityLabel))
    );

    // Prefer opus/webm, then mp4a/mp4
    const best =
      audioFormats.find((f) => f.mimeType?.includes("opus")) ||
      audioFormats.find((f) => f.mimeType?.includes("mp4a")) ||
      audioFormats[0];

    return best?.url ?? null;
  } catch {
    return null;
  }
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { youtubeUrl } = await req.json();
    if (!youtubeUrl) {
      return new Response(JSON.stringify({ error: "youtubeUrl is required" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const ytMatch = youtubeUrl.match(/(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (!ytMatch) {
      return new Response(JSON.stringify({ error: "Invalid YouTube URL" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
    const videoId = ytMatch[1];

    const audioUrl = await getYouTubeAudioUrl(videoId);
    if (!audioUrl) {
      return new Response(JSON.stringify({
        error: "Could not extract audio from this video. It may be age-restricted, private, or region-locked.",
      }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const assemblyKey = Netlify.env.get("ASSEMBLYAI_API_KEY");
    if (!assemblyKey) {
      return new Response(JSON.stringify({ error: "Transcription service not configured" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    const aaiRes = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: { "authorization": assemblyKey, "content-type": "application/json" },
      body: JSON.stringify({ audio_url: audioUrl, speech_models: ["universal"] }),
    });

    if (!aaiRes.ok) {
      const errText = await aaiRes.text();
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

    const jobId = `yt-audio-${videoId}-${Date.now()}`;
    const store = getStore("podlens-jobs");
    await store.setJSON(jobId, {
      status: "transcribing",
      jobId,
      transcriptId,
      url: youtubeUrl,
      createdAt: Date.now(),
    });

    return new Response(JSON.stringify({ jobId }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: "Server error: " + (e?.message || "Unknown error") }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/transcribe/start" };
