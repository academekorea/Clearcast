import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// ── URL NORMALIZATION ─────────────────────────────────────────────────────

function extractVideoId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

/** Returns a clean https://www.youtube.com/watch?v=ID URL, or null if not YouTube. */
function normalizeYouTubeUrl(url: string): string | null {
  const id = extractVideoId(url);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

// ── PRE-FLIGHT CHECK ──────────────────────────────────────────────────────

function parseIsoDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || "0") * 3600) + (parseInt(m[2] || "0") * 60) + parseInt(m[3] || "0");
}

interface PreflightResult {
  ok: boolean;
  code?: string;
  message?: string;
  duration?: number;
  pendingCaptions?: boolean;
}

async function preflightCheck(videoId: string, apiKey: string): Promise<PreflightResult> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${videoId}&key=${apiKey}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return { ok: true }; // API failure → let caption fetch decide

    const data = await res.json();
    const item = data.items?.[0];
    if (!item) {
      return { ok: false, code: "VIDEO_NOT_FOUND", message: "Video not found or unavailable." };
    }

    const { snippet, contentDetails, status } = item;

    if (status?.privacyStatus !== "public") {
      return { ok: false, code: "VIDEO_PRIVATE", message: "This video is private." };
    }

    if (snippet?.liveBroadcastContent === "live") {
      return { ok: false, code: "IS_LIVESTREAM", message: "This is a live stream." };
    }

    const durationSec = parseIsoDuration(contentDetails?.duration || "");
    if (durationSec > 5400) {
      return { ok: false, code: "TOO_LONG", message: "Video exceeds 90 minutes.", duration: durationSec };
    }

    // Published within last 30 minutes — auto-captions may not be ready yet
    const publishedAt = snippet?.publishedAt ? new Date(snippet.publishedAt).getTime() : 0;
    const pendingCaptions = publishedAt > 0 && Date.now() - publishedAt < 30 * 60 * 1000;

    return { ok: true, duration: durationSec, pendingCaptions };
  } catch {
    return { ok: true }; // Never block on preflight failure
  }
}

// ── CAPTION FETCH ─────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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

    // ── Strategy 1: extract captionTracks directly via regex ──
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

// ── AUDIO URL / RSS HELPERS ───────────────────────────────────────────────

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

// ── HANDLER ───────────────────────────────────────────────────────────────

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json();
    const { url: rawUrl, showName, showSlug, showArtwork, showFeedUrl, episodeTitle } = body;

    if (!rawUrl) {
      return new Response(JSON.stringify({ error: "URL is required" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const store = getStore("clearcast-jobs");

    // ── YouTube path ──────────────────────────────────────────────────────
    const normalizedYt = normalizeYouTubeUrl(rawUrl);
    if (normalizedYt) {
      const videoId = extractVideoId(normalizedYt)!;

      // Pre-flight check via YouTube Data API
      const ytApiKey = Netlify.env.get("YOUTUBE_API_KEY");
      if (ytApiKey) {
        const pre = await preflightCheck(videoId, ytApiKey);
        if (!pre.ok) {
          return new Response(JSON.stringify({ error: pre.message, code: pre.code, duration: pre.duration }), {
            status: 400, headers: { "Content-Type": "application/json" },
          });
        }

        // Caption retry loop for recently published videos
        if (pre.pendingCaptions) {
          let cap = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            if (attempt > 0) await sleep(10000);
            cap = await getYouTubeTranscript(videoId);
            if (cap) break;
          }
          if (cap) {
            const jobId = `yt-${videoId}-${Date.now()}`;
            await store.setJSON(jobId, {
              status: "transcribed", jobId, url: normalizedYt,
              transcript: cap.text, duration: cap.duration, createdAt: Date.now(),
              episodeTitle: episodeTitle || null, showName: showName || null,
              showSlug: showSlug || null, showArtwork: showArtwork || null,
              showFeedUrl: showFeedUrl || null,
            });
            return new Response(JSON.stringify({ jobId, status: "transcribed" }), {
              status: 200, headers: { "Content-Type": "application/json" },
            });
          }
          // After retries, fall through to CAPTIONS_UNAVAILABLE
          return new Response(JSON.stringify({
            error: "Captions aren't ready yet for this video. Try again in a few minutes.",
            code: "CAPTIONS_UNAVAILABLE",
          }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
      }

      // Standard caption fetch (single attempt)
      const cap = await getYouTubeTranscript(videoId);
      if (cap) {
        const jobId = `yt-${videoId}-${Date.now()}`;
        await store.setJSON(jobId, {
          status: "transcribed", jobId, url: normalizedYt,
          transcript: cap.text, duration: cap.duration, createdAt: Date.now(),
          episodeTitle: episodeTitle || null, showName: showName || null,
          showSlug: showSlug || null, showArtwork: showArtwork || null,
          showFeedUrl: showFeedUrl || null,
        });
        return new Response(JSON.stringify({ jobId, status: "transcribed" }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }

      // Signal frontend to try audio transcription fallback
      return new Response(JSON.stringify({
        error: "This video doesn't have captions enabled.",
        code: "CAPTIONS_UNAVAILABLE",
      }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    // ── Non-YouTube: direct audio / RSS path ──────────────────────────────
    const url = rawUrl;
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
      body: JSON.stringify({ audio_url: audioUrl, speech_models: ["universal"] }),
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
      status: "transcribing", transcriptId, url, audioUrl, createdAt: Date.now(),
      episodeTitle: episodeTitle || null, showName: showName || null,
      showSlug: showSlug || null, showArtwork: showArtwork || null,
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
