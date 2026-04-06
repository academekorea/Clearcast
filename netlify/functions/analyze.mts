import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { trackEvent, sbUpsert } from "./lib/supabase.js";
import { isSuperAdmin } from "./lib/admin.js";
import { checkRateLimit, getClientIp, rateLimitResponse, sanitizeUrl, checkSuspiciousActivity } from "./lib/security.js";

// ── URL NORMALIZATION ─────────────────────────────────────────────────────

function extractVideoId(url: string): string | null {
  const m = url.match(
    /(?:(?:music\.|podcasts\.)?youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

function extractPlaylistId(url: string): string | null {
  const m = url.match(/[?&]list=([^&#]+)/);
  return m ? m[1] : null;
}

function normalizeYouTubeUrl(url: string): string | null {
  const id = extractVideoId(url);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

function isYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com|youtu\.be|music\.youtube\.com|podcasts\.youtube\.com)/.test(url);
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

interface PodcastMatch {
  feedUrl: string;
  showName: string;
  showArtwork: string;
}

// ── KOREAN PODCAST PLATFORMS ──────────────────────────────────────────────

function extractKoreanPlatformRss(url: string): string | null {
  // Podbbang
  const podbbangM = url.match(/podbbang\.com\/channels\/(\d+)/);
  if (podbbangM) return `https://www.podbbang.com/channels/${podbbangM[1]}/rss`;
  // Naver AudioClip
  const naverM = url.match(/audioclip\.naver\.com\/channels\/(\d+)/);
  if (naverM) return `https://audioclip.naver.com/channels/${naverM[1]}/rss.xml`;
  return null;
}

async function searchApplePodcasts(channelTitle: string, store = "us"): Promise<PodcastMatch | null> {
  if (!channelTitle) return null;
  const storeParam = store !== "us" ? `&country=${store}` : "";
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(channelTitle)}&media=podcast&entity=podcast&limit=5${storeParam}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const results: any[] = data.results || [];
    if (!results.length) return null;

    let best: any = null, bestScore = 0;
    for (const r of results) {
      const score = similarity(channelTitle, r.collectionName || r.trackName || "");
      if (score > bestScore) { bestScore = score; best = r; }
    }

    if (!best || bestScore < 0.5 || !best.feedUrl) return null;
    return {
      feedUrl: best.feedUrl,
      showName: best.collectionName || best.trackName || channelTitle,
      showArtwork: best.artworkUrl100 || best.artworkUrl60 || "",
    };
  } catch {
    return null;
  }
}

// ── LAYER 3: Podcast Index (open endpoint) ────────────────────────────────

async function searchPodcastIndex(channelTitle: string): Promise<{feedUrl: string, showName: string} | null> {
  if (!channelTitle) return null;
  try {
    const res = await fetch(
      `https://api.podcastindex.org/api/1.0/search/byterm?q=${encodeURIComponent(channelTitle)}&max=3`,
      {
        headers: { "User-Agent": "Podlens/1.0" },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const match = (data.feeds || [])[0];
    if (!match?.url) return null;
    return { feedUrl: match.url, showName: match.title || channelTitle };
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
    body: JSON.stringify({ audio_url: audioUrl, speech_model: "best" }),
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

// ── RSS FEED DETECTION + PARSING ──────────────────────────────────────────

function isRssFeedUrl(url: string): boolean {
  const path = new URL(url).pathname.toLowerCase();
  return !!(
    path.includes("/feed") ||
    path.includes("/rss")  ||
    path.includes("/podcast.xml") ||
    path.endsWith(".xml")  ||
    path.endsWith(".rss")
  );
}

interface RssFeedResult {
  audioUrl: string;
  showName: string | null;
  episodeTitle: string | null;
}

async function getLatestEpisodeFromFeed(feedUrl: string): Promise<RssFeedResult | null> {
  try {
    const res = await fetch(feedUrl, {
      headers: { "User-Agent": "Podlens/1.0 podcast intelligence" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error(`[analyze] RSS feed ${feedUrl} returned ${res.status}`);
      return null;
    }
    const xml = await res.text();

    // Extract channel title (handles CDATA and plain text)
    const showTitleMatch =
      xml.match(/<channel>[\s\S]*?<title><!\[CDATA\[([^\]]+)\]\]><\/title>/) ||
      xml.match(/<channel>[\s\S]*?<title>([^<]{1,200})<\/title>/);
    const feedShowName = showTitleMatch ? showTitleMatch[1].trim() : null;

    // Find first <item>
    const itemMatch = xml.match(/<item>([\s\S]*?)<\/item>/i);
    if (!itemMatch) {
      console.error("[analyze] No <item> found in RSS feed:", feedUrl);
      return null;
    }
    const item = itemMatch[1];

    // Episode title
    const epTitleMatch =
      item.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/) ||
      item.match(/<title>([^<]{1,200})<\/title>/);
    const feedEpTitle = epTitleMatch ? epTitleMatch[1].trim() : null;

    // Audio URL — try enclosure (double and single quotes), then media:content
    const audioMatch =
      item.match(/<enclosure[^>]+url="([^"]+)"/i) ||
      item.match(/<enclosure[^>]+url='([^']+)'/i) ||
      item.match(/<media:content[^>]+url="([^"]+)"/i) ||
      item.match(/<media:content[^>]+url='([^']+)'/i);

    if (!audioMatch) {
      console.error("[analyze] No audio URL found in RSS feed item:", feedUrl);
      return null;
    }

    return {
      audioUrl: audioMatch[1].replace(/&amp;/g, "&"),
      showName: feedShowName,
      episodeTitle: feedEpTitle,
    };
  } catch (e: any) {
    console.error("[analyze] RSS feed error:", e?.message);
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

// ── TIER LIMITS ───────────────────────────────────────────────────────────

const PLAN_MONTHLY_LIMITS: Record<string, number> = {
  free:     3,
  creator:  25,
  operator: 100,
  studio:   Infinity,
  trial:    100,   // trial gets operator-level access
};

async function checkAndIncrementUsage(
  userStore: ReturnType<typeof getStore>,
  userId: string,
  plan: string
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limit = PLAN_MONTHLY_LIMITS[plan.toLowerCase()] ?? 3;
  if (!isFinite(limit)) return { allowed: true, used: 0, limit: Infinity };

  const key = `user-plan-${userId}`;
  let data: any = {};
  try { data = (await userStore.get(key, { type: "json" })) ?? {}; } catch {}

  const now = Date.now();
  const resetDate = data.monthResetDate ? new Date(data.monthResetDate).getTime() : 0;
  const isNewMonth = now > resetDate;

  const used = isNewMonth ? 0 : (data.analysesThisMonth ?? 0);
  if (used >= limit) return { allowed: false, used, limit };

  // Increment + write back (fire-and-forget — don't block the analysis)
  const nextReset = new Date(now);
  nextReset.setMonth(nextReset.getMonth() + 1, 1);
  nextReset.setHours(0, 0, 0, 0);

  userStore.setJSON(key, {
    ...data,
    analysesThisMonth: used + 1,
    monthResetDate: isNewMonth ? nextReset.toISOString() : (data.monthResetDate || nextReset.toISOString()),
  }).catch(() => {});

  return { allowed: true, used: used + 1, limit };
}

// ── HANDLER ───────────────────────────────────────────────────────────────

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const clientIp = getClientIp(req);

    // ── IP-level rate limit: 10 analyses per minute ───────────────────────
    const rl = await checkRateLimit(clientIp, "analyze", 10, 60);
    if (!rl.allowed) return rateLimitResponse(rl.resetIn);

    const body = await req.json();
    const { url: rawUrl, showName, showSlug, showArtwork, showFeedUrl, episodeTitle, store = "us", userId, userPlan, userEmail } = body;

    // ── Super admin bypass ────────────────────────────────────────────────
    const superAdmin = isSuperAdmin(userEmail || "");

    // ── Suspicious activity detection ────────────────────────────────────
    if (userId && userEmail && !superAdmin) {
      try {
        const sbUrl = Netlify.env.get("SUPABASE_URL");
        const sbKey = Netlify.env.get("SUPABASE_SERVICE_KEY");
        if (sbUrl && sbKey) {
          const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
          const countRes = await fetch(
            `${sbUrl}/rest/v1/analyses?user_id=eq.${userId}&created_at=gte.${hourAgo}&select=id`,
            { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, Prefer: "count=exact" },
              signal: AbortSignal.timeout(4000) }
          );
          const countHeader = countRes.headers.get("content-range");
          const recentCount = countHeader ? parseInt(countHeader.split("/")[1] || "0", 10) : 0;
          checkSuspiciousActivity(userId, userEmail, recentCount).catch(() => {});
        }
      } catch {}
    }

    // ── Track analysis_started event ──
    trackEvent(userId, 'analysis_started', {
      url: rawUrl || '',
      plan: superAdmin ? 'studio' : (userPlan || 'anonymous'),
    });
    // Upsert usage record
    if (userId) {
      const period = new Date().toISOString().slice(0, 7); // YYYY-MM
      sbUpsert('usage', { user_id: userId, period_start: period }, 'user_id,period_start').catch(() => {});
    }
    // Record job to Supabase analysis_queue (fire-and-forget)
    if (rawUrl) {
      sbInsert("analysis_queue", {
        user_id: userId || null,
        episode_url: rawUrl,
        status: "queued",
        queued_at: new Date().toISOString(),
      }).catch(() => {});
    }

    // ── Tier enforcement ──────────────────────────────────────────────────
    if (!superAdmin && userId && userPlan) {
      const userStore = getStore("podlens-users");
      const check = await checkAndIncrementUsage(userStore, userId, userPlan);
      if (!check.allowed) {
        return new Response(JSON.stringify({
          error: "limit_reached",
          used: check.used,
          limit: check.limit,
          plan: userPlan,
          message: `You've used all ${check.limit} analyses on your ${userPlan} plan this month.`,
        }), { status: 429, headers: { "Content-Type": "application/json" } });
      }
    }

    // ── Korean platform detection (before YouTube path) ──
    const koreanRss = extractKoreanPlatformRss(rawUrl || "");
    if (koreanRss) {
      return new Response(JSON.stringify({
        status: "needs_episode_selection",
        feedUrl: koreanRss,
        showName: showName || "",
        showArtwork: showArtwork || "",
        channelName: showName || "",
        isKorean: true,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (!rawUrl) {
      return new Response(JSON.stringify({ error: "URL is required" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const blobStore = getStore("podlens-jobs");

    // ── YouTube playlist → episode picker ────────────────────────────────
    const playlistId = extractPlaylistId(rawUrl);
    if (playlistId && isYouTubeUrl(rawUrl) && !extractVideoId(rawUrl)) {
      const ytApiKey = Netlify.env.get("YOUTUBE_API_KEY");
      if (ytApiKey) {
        try {
          const plRes = await fetch(
            `https://www.googleapis.com/youtube/v3/playlistItems?playlistId=${playlistId}&part=snippet&maxResults=20&key=${ytApiKey}`,
            { signal: AbortSignal.timeout(8000) }
          );
          if (plRes.ok) {
            const plData = await plRes.json();
            const episodes = (plData.items || []).map((item: any) => ({
              title: item.snippet?.title || "",
              videoId: item.snippet?.resourceId?.videoId || "",
              thumbnail: item.snippet?.thumbnails?.medium?.url || "",
              publishedAt: item.snippet?.publishedAt || "",
              url: `https://www.youtube.com/watch?v=${item.snippet?.resourceId?.videoId}`,
            })).filter((e: any) => e.videoId);
            return new Response(JSON.stringify({
              status: "needs_episode_selection",
              playlistId,
              episodes,
              showName: plData.items?.[0]?.snippet?.channelTitle || "",
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
        } catch { /* fall through to normal path */ }
      }
    }

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
          await blobStore.setJSON(jobId, {
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
        await blobStore.setJSON(jobId, {
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
        searchApplePodcasts(channelTitle, store as string),          // Layer 2
        searchPodcastIndex(channelTitle),                   // Layer 3
        retryFromYouTubeChannelRss(channelId, videoId),    // Layer 4 (caption retry)
      ]);

      // Layer 4: caption retry succeeded
      if (rssRetryResult.status === "fulfilled" && rssRetryResult.value) {
        console.log(`[analyze] Layer 4 SUCCESS: caption retry worked`);
        return saveCaption(rssRetryResult.value, "rss-retry");
      }

      // Layer 2 (Apple Podcasts): podcast found with similarity > 0.5 → show episode picker
      const appleMatch = appleResult.status === "fulfilled" ? appleResult.value : null;
      if (appleMatch) {
        console.log(`[analyze] Layer 2 SUCCESS: Apple Podcasts found → needs_episode_selection`);
        return new Response(JSON.stringify({
          status: "needs_episode_selection",
          feedUrl: appleMatch.feedUrl,
          showName: appleMatch.showName,
          showArtwork: appleMatch.showArtwork,
          channelName: channelTitle,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      // Layer 3 (Podcast Index): podcast found → show episode picker
      const piMatch = podcastIndexResult.status === "fulfilled" ? podcastIndexResult.value : null;
      if (piMatch) {
        console.log(`[analyze] Layer 3 SUCCESS: PodcastIndex found → needs_episode_selection`);
        return new Response(JSON.stringify({
          status: "needs_episode_selection",
          feedUrl: piMatch.feedUrl,
          showName: piMatch.showName,
          showArtwork: "",
          channelName: channelTitle,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      // All layers failed → smart search UI (Layer 4 smart search)
      console.log(`[analyze] All layers failed → needs_search`);
      return new Response(JSON.stringify({
        status: "needs_search",
        channelName: channelTitle || videoTitle || "",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // ── Non-YouTube: RSS feed / direct audio path ────────────────────────
    const url = rawUrl;
    const assemblyKey = Netlify.env.get("ASSEMBLYAI_API_KEY");
    if (!assemblyKey) {
      return new Response(JSON.stringify({ error: "Transcription service not configured" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    // ── RSS feed: extract latest episode audio URL + metadata ──────────
    try {
      if (isRssFeedUrl(url)) {
        console.log(`[analyze] RSS feed detected: ${url}`);
        const rssResult = await getLatestEpisodeFromFeed(url);
        if (rssResult) {
          console.log(`[analyze] RSS: show="${rssResult.showName}" ep="${rssResult.episodeTitle}" audio="${rssResult.audioUrl}"`);
          return submitToAssemblyAI(rssResult.audioUrl, url, {
            episodeTitle: episodeTitle || rssResult.episodeTitle || null,
            showName:     showName     || rssResult.showName    || null,
            showSlug:     showSlug     || null,
            showArtwork:  showArtwork  || null,
            showFeedUrl:  url,
          }, blobStore, assemblyKey);
        }
        // Fall through to generic extractAudioUrl if parser returns null
        console.log(`[analyze] RSS parse failed, falling back to extractAudioUrl`);
      }
    } catch (rssErr: any) {
      console.error("[analyze] RSS handler error:", rssErr?.message);
      // Fall through to generic path
    }

    // ── Generic: direct audio file or URL that may contain audio ────────
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
    }, blobStore, assemblyKey);

  } catch (e: any) {
    console.error("Analyze error:", e);
    return new Response(JSON.stringify({ error: "Server error: " + (e?.message || "Unknown error") }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = { path: "/api/analyze" };
