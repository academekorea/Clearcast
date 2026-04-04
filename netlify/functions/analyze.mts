import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// ── URL NORMALIZATION ─────────────────────────────────────────────────────

function extractVideoId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

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
  pendingCaptions?: boolean;
}

async function preflightCheck(videoId: string, apiKey: string): Promise<PreflightResult> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${videoId}&key=${apiKey}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return { ok: true };

    const data = await res.json();
    const item = data.items?.[0];
    if (!item) return { ok: false, code: "VIDEO_NOT_FOUND", message: "Video not found or unavailable." };

    const { snippet, contentDetails, status } = item;

    if (status?.privacyStatus !== "public") {
      return { ok: false, code: "VIDEO_PRIVATE", message: "This video is private." };
    }
    if (snippet?.liveBroadcastContent === "live") {
      return { ok: false, code: "IS_LIVESTREAM", message: "This is a live stream." };
    }

    const wrongContentTypes: Record<string, string> = {
      "10": "This looks like a music video, not a podcast. Try a talk show or interview instead.",
      "30": "This looks like a film, not a podcast. Try a talk show or interview instead.",
      "44": "This looks like a movie trailer, not a podcast.",
    };
    const categoryMsg = wrongContentTypes[snippet?.categoryId];
    if (categoryMsg) return { ok: false, code: "WRONG_CONTENT_TYPE", message: categoryMsg };

    const publishedAt = snippet?.publishedAt ? new Date(snippet.publishedAt).getTime() : 0;
    const pendingCaptions = publishedAt > 0 && Date.now() - publishedAt < 30 * 60 * 1000;

    return { ok: true, pendingCaptions };
  } catch {
    return { ok: true };
  }
}

// ── YOUTUBE PAGE FETCH (captions + metadata in one request) ───────────────

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

interface YouTubePageData {
  captionResult: { text: string; duration: string } | null;
  channelTitle: string;
  videoTitle: string;
  channelId: string;
}

async function fetchYouTubePage(videoId: string): Promise<YouTubePageData> {
  const empty: YouTubePageData = { captionResult: null, channelTitle: "", videoTitle: "", channelId: "" };
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

    let channelTitle = "";
    let videoTitle = "";
    let channelId = "";
    let captionResult: { text: string; duration: string } | null = null;

    // ── Strategy 1: captionTracks regex (fast path) ──
    const ctMatch = html.match(/"captionTracks":\s*(\[.*?\])\s*,\s*"audioTracks"/s);
    if (ctMatch) {
      try {
        const tracks: any[] = JSON.parse(ctMatch[1]);
        const track =
          tracks.find((t) => t.languageCode === "en" && !t.kind) ||
          tracks.find((t) => t.languageCode === "en") ||
          tracks.find((t) => t.languageCode?.startsWith("en")) ||
          tracks[0];
        if (track?.baseUrl) captionResult = await fetchCaptionsFromBaseUrl(track.baseUrl);
      } catch { /* fall through */ }
    }

    // ── Strategy 2: full ytInitialPlayerResponse parse (also extracts metadata) ──
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
          // Extract video metadata
          channelTitle = pr?.videoDetails?.author || "";
          videoTitle = pr?.videoDetails?.title || "";
          channelId = pr?.videoDetails?.channelId || "";
          // Try captions if not already found
          if (!captionResult) {
            const tracks: any[] = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
            const track =
              tracks.find((t: any) => t.languageCode === "en" && !t.kind) ||
              tracks.find((t: any) => t.languageCode === "en") ||
              tracks.find((t: any) => t.languageCode?.startsWith("en")) ||
              tracks[0];
            if (track?.baseUrl) captionResult = await fetchCaptionsFromBaseUrl(track.baseUrl);
          }
        } catch { /* fall through */ }
      }
    }

    // ── Strategy 3: loose baseUrl regex scan ──
    if (!captionResult) {
      for (const m of html.matchAll(/"baseUrl":"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]+)"/g)) {
        try {
          const baseUrl = m[1].replace(/\\u0026/g, "&");
          captionResult = await fetchCaptionsFromBaseUrl(baseUrl);
          if (captionResult) break;
        } catch { /* try next */ }
      }
    }

    return { captionResult, channelTitle, videoTitle, channelId };
  } catch {
    return empty;
  }
}

// ── PODCAST RSS HELPERS ───────────────────────────────────────────────────

function similarity(a: string, b: string): number {
  const words = (s: string) =>
    new Set(s.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(w => w.length > 2));
  const wa = words(a), wb = words(b);
  if (!wa.size || !wb.size) return 0;
  let overlap = 0;
  for (const w of wa) if (wb.has(w)) overlap++;
  return overlap / Math.max(wa.size, wb.size);
}

async function findEpisodeInRss(feedUrl: string, videoTitle: string): Promise<string | null> {
  try {
    const res = await fetch(feedUrl, {
      headers: { "User-Agent": "Podlens/1.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const xml = await res.text();

    const items: { title: string; url: string }[] = [];
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
      const c = m[1];
      const rawTitle = c.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "";
      const title = rawTitle.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
      const url =
        c.match(/<enclosure[^>]+url="([^"]+)"/i)?.[1] ||
        c.match(/<enclosure[^>]+url='([^']+)'/i)?.[1] ||
        c.match(/<media:content[^>]+url="([^"]+)"/i)?.[1] || "";
      if (url) items.push({ title, url });
    }

    if (!items.length) return null;

    if (videoTitle) {
      const best = items
        .map(item => ({ ...item, score: similarity(item.title, videoTitle) }))
        .sort((a, b) => b.score - a.score)[0];
      if (best.score > 0.25) return best.url;
    }
    return items[0].url; // Fall back to most recent episode
  } catch {
    return null;
  }
}

// ── LAYER 2: Apple Podcasts ───────────────────────────────────────────────

async function searchApplePodcasts(channelTitle: string, videoTitle: string): Promise<string | null> {
  if (!channelTitle) return null;
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(channelTitle)}&media=podcast&entity=podcast&limit=5`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const results: any[] = data.results || [];
    if (!results.length) return null;

    const cl = channelTitle.toLowerCase();
    const match =
      results.find(r =>
        r.collectionName?.toLowerCase().includes(cl) ||
        cl.includes(r.collectionName?.toLowerCase() || "") ||
        r.artistName?.toLowerCase().includes(cl)
      ) || results[0];

    return match?.feedUrl ? findEpisodeInRss(match.feedUrl, videoTitle) : null;
  } catch {
    return null;
  }
}

// ── LAYER 3: Podcast Index (open endpoint) ────────────────────────────────

async function searchPodcastIndex(channelTitle: string, videoTitle: string): Promise<string | null> {
  if (!channelTitle) return null;
  try {
    const res = await fetch(
      `https://podcastindex.org/api/search/byterm?q=${encodeURIComponent(channelTitle)}&max=3`,
      {
        headers: { "User-Agent": "Podlens/1.0" },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const match = (data.feeds || [])[0];
    return match?.url ? findEpisodeInRss(match.url, videoTitle) : null;
  } catch {
    return null;
  }
}

// ── LAYER 4: YouTube Channel RSS → caption retry ──────────────────────────

async function retryFromYouTubeChannelRss(
  channelId: string,
  videoId: string
): Promise<{ text: string; duration: string } | null> {
  if (!channelId) return null;
  try {
    const res = await fetch(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const xml = await res.text();
    if (!xml.includes(videoId)) return null; // Video not in this channel's feed

    // Retry caption fetch — may succeed on transient failures
    const retry = await fetchYouTubePage(videoId);
    return retry.captionResult;
  } catch {
    return null;
  }
}

// ── ASSEMBLYAI SUBMISSION HELPER ──────────────────────────────────────────

async function submitToAssemblyAI(
  audioUrl: string,
  sourceUrl: string,
  meta: { episodeTitle?: string | null; showName?: string | null; showSlug?: string | null; showArtwork?: string | null; showFeedUrl?: string | null },
  store: ReturnType<typeof getStore>,
  assemblyKey: string
): Promise<Response> {
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

  const { id: transcriptId } = await aaiRes.json();
  if (!transcriptId) {
    return new Response(JSON.stringify({ error: "Failed to start transcription. Please try again." }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  await store.setJSON(transcriptId, {
    status: "transcribing", transcriptId, url: sourceUrl, audioUrl, createdAt: Date.now(),
    episodeTitle: meta.episodeTitle || null, showName: meta.showName || null,
    showSlug: meta.showSlug || null, showArtwork: meta.showArtwork || null,
    showFeedUrl: meta.showFeedUrl || null,
  });

  return new Response(JSON.stringify({ jobId: transcriptId, status: "transcribing" }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}

// ── AUDIO URL / RSS HELPERS (non-YouTube path) ────────────────────────────

async function extractAudioUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Podlens/1.0)",
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
    url.includes("audio") || url.includes("media") || url.includes("cdn") ||
    url.includes("podcast") || url.includes("episode") ||
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

    const store = getStore("podlens-jobs");

    // ── YouTube path ──────────────────────────────────────────────────────
    const normalizedYt = normalizeYouTubeUrl(rawUrl);
    if (normalizedYt) {
      const videoId = extractVideoId(normalizedYt)!;
      const ytCache = getStore("yt-cache");

      // ── Cache check (Layer 0) ──
      try {
        const cached = await ytCache.get(videoId, { type: "json" }) as any;
        if (cached?.transcript && cached.createdAt && Date.now() - cached.createdAt < 7 * 24 * 60 * 60 * 1000) {
          const jobId = `yt-${videoId}-cached-${Date.now()}`;
          await store.setJSON(jobId, {
            status: "transcribed", jobId, url: normalizedYt,
            transcript: cached.transcript, duration: cached.duration || "",
            createdAt: Date.now(),
            episodeTitle: episodeTitle || null, showName: showName || null,
            showSlug: showSlug || null, showArtwork: showArtwork || null,
            showFeedUrl: showFeedUrl || null,
          });
          return new Response(JSON.stringify({ jobId, status: "transcribed", cached: true }), {
            status: 200, headers: { "Content-Type": "application/json" },
          });
        }
      } catch { /* cache miss — continue */ }

      // ── Pre-flight check ──
      const ytApiKey = Netlify.env.get("YOUTUBE_API_KEY");
      let pendingCaptions = false;
      if (ytApiKey) {
        const pre = await preflightCheck(videoId, ytApiKey);
        if (!pre.ok) {
          return new Response(JSON.stringify({ error: pre.message, code: pre.code }), {
            status: 400, headers: { "Content-Type": "application/json" },
          });
        }
        pendingCaptions = pre.pendingCaptions || false;
      }

      // ── Layer 1: YouTube captions (also extracts channel metadata) ──
      console.log(`[analyze] Layer 1: fetching YouTube page for ${videoId}`);
      let pageData = await fetchYouTubePage(videoId);
      console.log(`[analyze] Layer 1 result: captionResult=${!!pageData.captionResult}, channelTitle="${pageData.channelTitle}", videoTitle="${pageData.videoTitle}", channelId="${pageData.channelId}"`);

      if (!pageData.captionResult && pendingCaptions) {
        for (let attempt = 0; attempt < 2; attempt++) {
          await sleep(10000);
          const retry = await fetchYouTubePage(videoId);
          if (retry.captionResult) { pageData = { ...pageData, captionResult: retry.captionResult }; break; }
        }
      }

      const saveCaption = async (cap: { text: string; duration: string }, source: string) => {
        const jobId = `yt-${videoId}-${Date.now()}`;
        await store.setJSON(jobId, {
          status: "transcribed", jobId, url: normalizedYt,
          transcript: cap.text, duration: cap.duration, createdAt: Date.now(),
          episodeTitle: episodeTitle || pageData.videoTitle || null,
          showName: showName || pageData.channelTitle || null,
          showSlug: showSlug || null, showArtwork: showArtwork || null, showFeedUrl: showFeedUrl || null,
        });
        await ytCache.setJSON(videoId, {
          transcript: cap.text, duration: cap.duration, source, createdAt: Date.now(),
        });
        return new Response(JSON.stringify({ jobId, status: "transcribed" }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      };

      if (pageData.captionResult) {
        console.log(`[analyze] Layer 1 SUCCESS: captions found, length=${pageData.captionResult.text.length}`);
        return saveCaption(pageData.captionResult, "captions");
      }

      console.log(`[analyze] Layer 1 FAILED: no captions`);

      const { channelTitle, videoTitle, channelId } = pageData;

      // ── Layers 2-4: run in parallel ──
      console.log(`[analyze] Layers 2-4 parallel: channelTitle="${channelTitle}", videoTitle="${videoTitle}", channelId="${channelId}"`);
      const [appleResult, podcastIndexResult, rssRetryResult] = await Promise.allSettled([
        searchApplePodcasts(channelTitle, videoTitle),     // Layer 2
        searchPodcastIndex(channelTitle, videoTitle),       // Layer 3
        retryFromYouTubeChannelRss(channelId, videoId),    // Layer 4
      ]);
      console.log(`[analyze] Layer 2 (Apple): ${appleResult.status} value=${appleResult.status === "fulfilled" ? appleResult.value : appleResult.reason}`);
      console.log(`[analyze] Layer 3 (PodcastIndex): ${podcastIndexResult.status} value=${podcastIndexResult.status === "fulfilled" ? podcastIndexResult.value : podcastIndexResult.reason}`);
      console.log(`[analyze] Layer 4 (RSS retry): ${rssRetryResult.status} value=${rssRetryResult.status === "fulfilled" ? !!rssRetryResult.value : rssRetryResult.reason}`);

      // Layer 4: caption retry succeeded
      if (rssRetryResult.status === "fulfilled" && rssRetryResult.value) {
        console.log(`[analyze] Layer 4 SUCCESS: caption retry worked`);
        return saveCaption(rssRetryResult.value, "rss-retry");
      }

      // Layers 2-3: podcast MP3 found → submit to AssemblyAI
      const assemblyKey = Netlify.env.get("ASSEMBLYAI_API_KEY");
      if (assemblyKey) {
        const podcastAudioUrl =
          (appleResult.status === "fulfilled" && appleResult.value) ||
          (podcastIndexResult.status === "fulfilled" && podcastIndexResult.value) ||
          null;

        if (podcastAudioUrl) {
          console.log(`[analyze] Layers 2-3 SUCCESS: podcast MP3 found, submitting to AssemblyAI: ${podcastAudioUrl}`);
          return submitToAssemblyAI(podcastAudioUrl, normalizedYt, {
            episodeTitle: episodeTitle || videoTitle,
            showName: showName || channelTitle,
            showSlug, showArtwork, showFeedUrl,
          }, store, assemblyKey);
        }
      }

      // All layers failed → signal frontend for Layer 5 (yt-dlp) or Layer 6 (recovery UI)
      console.log(`[analyze] All layers failed → returning CAPTIONS_UNAVAILABLE`);
      return new Response(JSON.stringify({
        error: "Captions not found.",
        code: "CAPTIONS_UNAVAILABLE",
        channelTitle: channelTitle || "",
        videoTitle: videoTitle || "",
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

    return submitToAssemblyAI(audioUrl, url, {
      episodeTitle: episodeTitle || null, showName: showName || null,
      showSlug: showSlug || null, showArtwork: showArtwork || null, showFeedUrl: showFeedUrl || null,
    }, store, assemblyKey);

  } catch (e: any) {
    console.error("Analyze error:", e);
    return new Response(JSON.stringify({ error: "Server error: " + (e?.message || "Unknown error") }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/analyze" };
