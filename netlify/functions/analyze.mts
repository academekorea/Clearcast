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

async function fetchCaptionsFromBaseUrl(baseUrl: string): Promise<{ text: string; duration: string } | null> {
  const capRes = await fetch(`${baseUrl}&fmt=json3`, { signal: AbortSignal.timeout(10000) });
  if (!capRes.ok) return null;
  const capData = await capRes.json() as any;
  const events: any[] = capData.events || [];
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
}

async function getYouTubeTranscript(videoId: string): Promise<{ text: string; duration: string } | null> {
  try {
    // Fetch the YouTube watch page — add CONSENT cookie to bypass geo/GDPR gate
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Cookie": "CONSENT=YES+cb.20210328-17-p0.en+FX+999; SOCS=CAESEwgDEgk2MDIzMDEwMRoCZW4gAQ==",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
      },
      signal: AbortSignal.timeout(15000),
    });
    const html = await pageRes.text();

    // ── Strategy 1: extract captionTracks directly via regex (faster, more resilient) ──
    const ctMatch = html.match(/"captionTracks":\s*(\[.*?\])\s*,\s*"audioTracks"/s);
    if (ctMatch) {
      try {
        const tracks: any[] = JSON.parse(ctMatch[1]);
        const track =
          tracks.find((t) => t.languageCode === "en" && !t.kind) ||
          tracks.find((t) => t.languageCode === "en") ||
          tracks.find((t) => t.languageCode?.startsWith("en")) ||
          tracks[0];
        if (track?.baseUrl) {
          const result = await fetchCaptionsFromBaseUrl(track.baseUrl);
          if (result) return result;
        }
      } catch { /* fall through */ }
    }

    // ── Strategy 2: full ytInitialPlayerResponse bracket parse ──
    const marker = "ytInitialPlayerResponse = ";
    const markerIdx = html.indexOf(marker);
    if (markerIdx !== -1) {
      const jsonStart = markerIdx + marker.length;
      let depth = 0, jsonEnd = -1;
      for (let i = jsonStart; i < Math.min(jsonStart + 600000, html.length); i++) {
        if (html[i] === "{") depth++;
        else if (html[i] === "}") { depth--; if (depth === 0) { jsonEnd = i; break; } }
      }
      if (jsonEnd !== -1) {
        try {
          const pr = JSON.parse(html.slice(jsonStart, jsonEnd + 1));
          const tracks: any[] = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
          const track =
            tracks.find((t: any) => t.languageCode === "en" && !t.kind) ||
            tracks.find((t: any) => t.languageCode === "en") ||
            tracks.find((t: any) => t.languageCode?.startsWith("en")) ||
            tracks[0];
          if (track?.baseUrl) {
            const result = await fetchCaptionsFromBaseUrl(track.baseUrl);
            if (result) return result;
          }
        } catch { /* fall through */ }
      }
    }

    // ── Strategy 3: loose baseUrl regex scan ──
    const urlMatches = [...html.matchAll(/"baseUrl":"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]+)"/g)];
    for (const m of urlMatches) {
      try {
        const baseUrl = m[1].replace(/\\u0026/g, "&");
        const result = await fetchCaptionsFromBaseUrl(baseUrl);
        if (result) return result;
      } catch { /* try next */ }
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
    const { url, showName, showSlug, showArtwork, showFeedUrl, episodeTitle } = body;

    if (!url) {
      return new Response(JSON.stringify({ error: "URL is required" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const store = getStore("clearcast-jobs");

    // YouTube: try captions first, fall back to AssemblyAI if unavailable
    const ytMatch = url.match(/(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) {
      const cap = await getYouTubeTranscript(ytMatch[1]);
      if (cap) {
        const jobId = `yt-${ytMatch[1]}-${Date.now()}`;
        await store.setJSON(jobId, {
          status: "transcribed",
          jobId,
          url,
          transcript: cap.text,
          duration: cap.duration,
          createdAt: Date.now(),
          episodeTitle: episodeTitle || null,
          showName: showName || null,
          showSlug: showSlug || null,
          showArtwork: showArtwork || null,
          showFeedUrl: showFeedUrl || null,
        });
        return new Response(JSON.stringify({ jobId, status: "transcribed" }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      // Captions unavailable — fall through to AssemblyAI transcription using the YouTube URL directly
    }

    // YouTube (captions failed) or non-YouTube: send to AssemblyAI
    const assemblyKey = Netlify.env.get("ASSEMBLYAI_API_KEY");
    if (!assemblyKey) {
      return new Response(JSON.stringify({ error: "Transcription service not configured" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    let audioUrl = url;
    const isYouTube = !!ytMatch;
    if (!isYouTube && !url.match(/\.(mp3|m4a|ogg|wav|aac)(\?|$)/i)) {
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
      body: JSON.stringify({ audio_url: audioUrl, speech_models: { model: "universal" } }),
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
      episodeTitle: episodeTitle || null,
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
