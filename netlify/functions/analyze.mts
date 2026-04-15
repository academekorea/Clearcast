import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { submitTranscription, uploadAndTranscribe } from "./lib/assemblyai.js";

// ── CANONICAL URL NORMALIZER ──────────────────────────────────────────────────
// Returns a stable canonical key regardless of URL variant.
// youtube.com/watch?v=X, youtu.be/X, youtube.com/shorts/X → "yt:X"
function canonicalKey(url: string): string {
  // YouTube
  const ytPatterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of ytPatterns) {
    const m = url.match(p);
    if (m?.[1]) return `yt:${m[1]}`;
  }
  // Spotify episode
  const spEp = url.match(/spotify\.com\/episode\/([a-zA-Z0-9]+)/);
  if (spEp?.[1]) return `sp:${spEp[1]}`;
  // Apple Podcasts episode
  const apEp = url.match(/podcasts\.apple\.com\/.*?\/id(\d+).*?i=(\d+)/);
  if (apEp) return `ap:${apEp[1]}:${apEp[2]}`;
  // Direct audio — normalize by stripping query params for cache
  try {
    const u = new URL(url);
    if (/\.(mp3|m4a|ogg|wav|aac|opus)$/i.test(u.pathname)) {
      return `audio:${u.hostname}${u.pathname}`;
    }
  } catch {}
  // Fallback: base64 of normalized URL
  return `url:${Buffer.from(url.toLowerCase().trim()).toString("base64").replace(/[^a-zA-Z0-9]/g,"").slice(0,60)}`;
}

// ── URL TYPE DETECTOR ─────────────────────────────────────────────────────────
function detectUrlType(url: string): "youtube" | "spotify" | "apple" | "rss" | "audio" | "unknown" {
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  if (/open\.spotify\.com/.test(url)) return "spotify";
  if (/podcasts\.apple\.com/.test(url)) return "apple";
  if (/\.(mp3|m4a|ogg|wav|aac|opus)(\?|$)/i.test(url) || /podtrac|pdst\.fm|blubrry|audio/.test(url)) return "audio";
  if (/\.(xml|rss)(\?|$)/i.test(url) || /feeds\.|\/feed|\/rss|rss\.|podcast\.rss|\/podcast$|anchor\.fm.*\/rss|podbean\.com.*\/feed|buzzsprout\.com\/.*\/podcast|omnycontent\.com|art19\.com|simplecast\.com|megaphone\.fm|podtrac\.com\/pts\/redirect/.test(url)) return "rss";
  return "unknown";
}

// ── APPLE PODCASTS → RSS RESOLVER ────────────────────────────────────────────
async function resolveApplePodcastsUrl(url: string): Promise<{ audioUrl: string | null; episodeTitle: string; showName: string }> {
  const empty = { audioUrl: null, episodeTitle: "", showName: "" };
  try {
    // Extract show ID and episode ID from Apple URL
    const showIdMatch = url.match(/\/id(\d+)/);
    const epIdMatch = url.match(/[?&]i=(\d+)/);
    if (!showIdMatch) return empty;

    const showId = showIdMatch[1];

    // Look up show in iTunes API
    const lookupUrl = epIdMatch
      ? `https://itunes.apple.com/lookup?id=${showId}&entity=podcastEpisode&episodeId=${epIdMatch[1]}&limit=1`
      : `https://itunes.apple.com/lookup?id=${showId}&entity=podcastEpisode&limit=1`;

    const res = await fetch(lookupUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return empty;
    const data = await res.json();

    const ep = data.results?.find((r: any) => r.wrapperType === "podcastEpisode" || r.kind === "podcast-episode");
    const show = data.results?.find((r: any) => r.wrapperType === "track" && r.kind === "podcast") || data.results?.[0];

    return {
      audioUrl: ep?.episodeUrl || null,
      episodeTitle: ep?.trackName || "",
      showName: show?.collectionName || show?.trackName || "",
    };
  } catch { return empty; }
}

// ── RSS FEED → AUDIO RESOLVER ─────────────────────────────────────────────────
function extractAttr(tag: string, attr: string): string | null {
  const re = new RegExp(`\\b${attr}\\s*=\\s*(?:"([^"]*?)"|'([^']*?)'|([^\\s>]+))`, "i");
  const m = tag.match(re);
  const val = m?.[1] ?? m?.[2] ?? m?.[3] ?? null;
  return val ? val.replace(/&amp;/g, "&").replace(/<!\[CDATA\[(.+?)\]\]>/, "$1").trim() : null;
}

function extractText(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([^<\\]]+?)(?:\\]\\]>)?<\/${tag}>`, "i");
  const m = block.match(re);
  return m?.[1]?.trim() || "";
}

async function resolveRssFeedToAudio(feedUrl: string): Promise<{ audioUrl: string | null; episodeTitle: string; showName: string; hostNames: string[] }> {
  const empty = { audioUrl: null, episodeTitle: "", showName: "", hostNames: [] as string[] };
  const userAgents = [
    "Mozilla/5.0 (compatible; Podlens/1.0; +https://podlens.app)",
    "Podlens/1.0 (podcast analysis bot)",
    "iTunes/12.0",
  ];

  let xml = "";
  let currentUrl = feedUrl;
  for (const ua of userAgents) {
    try {
      const res = await fetch(currentUrl, {
        signal: AbortSignal.timeout(12000),
        headers: { "User-Agent": ua, "Accept": "application/rss+xml, application/xml, text/xml, */*" },
        redirect: "follow",
      });
      if (res.ok) { xml = await res.text(); break; }
    } catch { continue; }
  }
  if (!xml) return empty;

  // Extract host names from feed metadata
  const hostNames = extractHostsFromFeedXml(xml);

  // Show name
  const channelMatch = xml.match(/<channel[^>]*>([\s\S]*?)<\/channel>/i);
  const channelXml = channelMatch?.[1] || xml;
  const showName = extractText(channelXml.slice(0, 2000), "title") || extractText(xml.slice(0, 500), "title") || "";

  function extractAudioFromBlock(block: string): { audioUrl: string | null; epTitle: string } {
    const epTitle = extractText(block, "title");
    // 1. <enclosure>
    const encTags = block.match(/<enclosure[^>]+>/gi) || [];
    for (const tag of encTags) {
      const url = extractAttr(tag, "url");
      if (url) return { audioUrl: url, epTitle };
    }
    // 2. <media:content>
    const mediaTags = block.match(/<media:content[^>]+>/gi) || [];
    for (const tag of mediaTags) {
      const url = extractAttr(tag, "url");
      const medium = extractAttr(tag, "medium");
      const type = extractAttr(tag, "type");
      if (url && (medium === "audio" || (type && /audio/i.test(type)) || /\.(mp3|m4a|ogg|wav|aac|opus)(\?|$)/i.test(url))) {
        return { audioUrl: url, epTitle };
      }
    }
    // 3. Any bare audio URL in the block
    const anyAudio = block.match(/https?:\/\/[^\s"'<>]+\.(?:mp3|m4a|ogg|wav|aac|opus)(?:\?[^\s"'<>]*)?/i);
    if (anyAudio) return { audioUrl: anyAudio[0], epTitle };
    // 4. Atom <link type="audio/...">
    const linkTags = block.match(/<link[^>]+>/gi) || [];
    for (const tag of linkTags) {
      const type = extractAttr(tag, "type");
      if (type && /audio/i.test(type)) {
        const href = extractAttr(tag, "href");
        if (href) return { audioUrl: href, epTitle };
      }
    }
    return { audioUrl: null, epTitle };
  }

  // Split on RSS <item> or Atom <entry>
  const rssItems = xml.split(/<item[\s>]/i);
  const atomItems = xml.split(/<entry[\s>]/i);
  const segments = rssItems.length >= atomItems.length ? rssItems : atomItems;
  for (let i = 1; i < Math.min(segments.length, 8); i++) {
    const { audioUrl, epTitle } = extractAudioFromBlock(segments[i]);
    if (audioUrl) return { audioUrl, episodeTitle: epTitle, showName, hostNames };
  }

  // Last resort: any audio URL in the whole feed
  const fallback = xml.match(/https?:\/\/[^\s"'<>]+\.(?:mp3|m4a|ogg|wav|aac|opus)(?:\?[^\s"'<>]*)?/i);
  if (fallback) return { audioUrl: fallback[0], episodeTitle: "", showName, hostNames };

  return empty;
}

// ── YOUTUBE CAPTIONS — TIMEDTEXT (no auth) ───────────────────────────────────
async function fetchYouTubeCaptionsNoAuth(videoId: string): Promise<string | null> {
  // Try manual captions first (en variants), then auto-generated (asr)
  // fmt=srv3 returns XML with <text> elements including timing
  const attempts = [
    // Manual captions — highest quality
    { lang: "en",    kind: "" },
    { lang: "en-US", kind: "" },
    { lang: "en-GB", kind: "" },
    { lang: "en-AU", kind: "" },
    // Auto-generated captions — available on most English YouTube videos
    { lang: "en",    kind: "asr" },
    { lang: "en-US", kind: "asr" },
  ];

  function parseTimedtextXml(xml: string): string {
    return (xml.match(/<text[^>]*>([^<]*)<\/text>/g) || [])
      .map(t => t
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\n/g, " ")
        .trim()
      )
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  for (const { lang, kind } of attempts) {
    try {
      const kindParam = kind ? `&kind=${kind}` : "";
      const res = await fetch(
        `https://www.youtube.com/api/timedtext?lang=${lang}&v=${videoId}&fmt=srv3${kindParam}`,
        { signal: AbortSignal.timeout(12000) }
      );
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml || xml.length < 200) continue;
      const captions = parseTimedtextXml(xml);
      if (captions && captions.length > 500) {
        console.log(`[analyze] timedtext success lang=${lang} kind=${kind || "manual"} chars=${captions.length}`);
        return captions;
      }
    } catch {}
  }

  // Last resort: try the public transcript endpoint (works on some videos)
  try {
    const res = await fetch(
      `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (res.ok) {
      const data = await res.json() as any;
      const text = (data.events || [])
        .filter((e: any) => e.segs)
        .flatMap((e: any) => e.segs.map((s: any) => s.utf8 || ""))
        .join(" ")
        .replace(/\n/g, " ")
        .trim();
      if (text.length > 500) {
        console.log(`[analyze] json3 timedtext success chars=${text.length}`);
        return text;
      }
    }
  } catch {}

  return null;
}

// ── YOUTUBE CAPTIONS — OAuth (user connected Google) ─────────────────────────
async function fetchYouTubeCaptionsOAuth(videoId: string, accessToken: string): Promise<string | null> {
  try {
    // Get captions list
    const tracksRes = await fetch(
      `https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${videoId}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) }
    );
    if (!tracksRes.ok) return null;
    const tracks = await tracksRes.json();
    const track = tracks.items?.find((t: any) =>
      t.snippet?.language?.startsWith("en") && t.snippet?.trackKind !== "forced"
    ) || tracks.items?.[0];
    if (!track) return null;

    // Download caption track
    const captionRes = await fetch(
      `https://www.googleapis.com/youtube/v3/captions/${track.id}?tfmt=srt`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) }
    );
    if (!captionRes.ok) return null;
    const srt = await captionRes.text();
    const captions = srt.split("\n")
      .filter(l => l.trim() && !/^\d+$/.test(l.trim()) && !/^\d{2}:\d{2}/.test(l))
      .join(" ").trim();
    return captions.length > 500 ? captions : null;
  } catch { return null; }
}

// ── YOUTUBE METADATA (video title, channel) ──────────────────────────────────
async function fetchYouTubeMetadata(videoId: string): Promise<{ title: string; channelTitle: string }> {
  try {
    const apiKey = Netlify.env.get("YOUTUBE_API_KEY");
    if (!apiKey) return { title: "", channelTitle: "" };
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return { title: "", channelTitle: "" };
    const d = await res.json();
    const snippet = d.items?.[0]?.snippet;
    return { title: snippet?.title || "", channelTitle: snippet?.channelTitle || "" };
  } catch { return { title: "", channelTitle: "" }; }
}

// ── REFRESH GOOGLE OAUTH TOKEN ────────────────────────────────────────────────
async function refreshGoogleToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: Netlify.env.get("GOOGLE_CLIENT_ID") || "",
        client_secret: Netlify.env.get("GOOGLE_CLIENT_SECRET") || "",
      }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d.access_token || null;
  } catch { return null; }
}

// ── RSS HOST EXTRACTION ──────────────────────────────────────────────────────
function extractHostsFromFeedXml(xml: string): string[] {
  const hosts: string[] = [];
  // 1. podcast:person role="host"
  const personRe = /<podcast:person[^>]*role=["']host["'][^>]*>([^<]+)<\/podcast:person>/gi;
  let m;
  while ((m = personRe.exec(xml)) !== null) hosts.push(m[1].trim());
  if (hosts.length) return [...new Set(hosts)].slice(0, 4);

  // 2. itunes:author (channel level — before first <item>)
  const channelBlock = xml.split(/<item[\s>]/i)[0] || xml;
  const itunesAuthor = channelBlock.match(/<itunes:author>([^<]+)<\/itunes:author>/i);
  if (itunesAuthor) hosts.push(itunesAuthor[1].trim());
  if (hosts.length) return [...new Set(hosts)].slice(0, 4);

  // 3. managingEditor (strip email)
  const editor = channelBlock.match(/<managingEditor>([^<]+)<\/managingEditor>/i);
  if (editor) {
    const cleaned = editor[1].replace(/\([^)]*\)/g, '').replace(/\S+@\S+/g, '').trim();
    if (cleaned) hosts.push(cleaned);
  }
  if (hosts.length) return [...new Set(hosts)].slice(0, 4);

  // 4. author in channel block
  const author = channelBlock.match(/<author>([^<]+)<\/author>/i);
  if (author) hosts.push(author[1].trim());

  return [...new Set(hosts)].slice(0, 4);
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await req.json();
  const { url, episodeTitle: epTitleRaw, showName: showNameRaw, userId, userEmail, isReRun } = body;
  if (!url) {
    return new Response(JSON.stringify({ error: "URL is required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const store = getStore("podlens-jobs");
  const usersStore = getStore("podlens-users");
  const { getSupabaseAdmin } = await import("./lib/supabase.js");

  // ── 0. Server-side analysis limit enforcement ─────────────────────────────
  // Prevents bypassing frontend limits by calling API directly
  const { userId: limitUserId, userPlan } = body;
  if (limitUserId && userPlan !== undefined) {
    const plan = String(userPlan || "free").toLowerCase();
    const SUPER_ADMIN = Netlify.env.get("SUPER_ADMIN_EMAIL") || "";
    const isAdmin = userEmail === SUPER_ADMIN;

    if (!isAdmin) {
      let monthLimit = 0;
      if (plan === "free") monthLimit = parseInt("4" || "4", 10);
      else if (plan === "creator") monthLimit = 25;
      // operator, studio, trial = unlimited (monthLimit stays 0)

      if (monthLimit > 0) {
        // Check usage in Supabase
        const sb = getSupabaseAdmin();
        if (sb) {
          try {
            const now = new Date();
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
            const { count } = await sb
              .from("analyses")
              .select("id", { count: "exact", head: true })
              .eq("user_id", limitUserId)
              .gte("created_at", monthStart);

            if ((count || 0) >= monthLimit) {
              return new Response(JSON.stringify({
                error: "Monthly analysis limit reached",
                code: "ANALYSIS_LIMIT",
                limit: monthLimit,
                plan,
              }), { status: 429, headers: { "Content-Type": "application/json" } });
            }
          } catch (e) {
            // If Supabase check fails, allow through (don't block on infra issues)
            console.warn("[analyze] limit check failed:", e);
          }
        }
      }
    }
  }

  // ── 1. Community cache check (speed optimization — instant results, quota still counted) (community-wide, permanent) ──────────────────
  const canonical = canonicalKey(url);
  const canonKey = `canon:${canonical}`;
  try {
    const cached = await store.get(canonKey, { type: "json" }) as any;
    if (cached?.status === "complete" && cached?.biasScore !== undefined) {
      console.log("[analyze] community cache hit:", canonical);
      const newCount = (cached.analyzeCount || 0) + 1;
      // Increment community counter in Blobs
      try {
        await store.setJSON(canonKey, { ...cached, analyzeCount: newCount, lastRequestedAt: Date.now() });
      } catch {}
      // Increment analyze_count in Supabase (non-blocking)
      try {
        const sbUrl = Netlify.env.get("SUPABASE_URL");
        const sbKey = Netlify.env.get("SUPABASE_SERVICE_KEY");
        if (sbUrl && sbKey) {
          const { createClient } = await import("@supabase/supabase-js");
          const sb = createClient(sbUrl, sbKey, { auth: { persistSession: false } });
          const { error } = await sb.from("analyses").update({
            analyze_count: newCount,
            analyzed_at: new Date().toISOString(),
          }).eq("canonical_key", canonical);
          if (error) console.error("[analyze] Supabase analyze_count update error:", error.message, error.code);
        }
      } catch {}
      return new Response(JSON.stringify({ jobId: cached.jobId, fromCache: true, communityCount: newCount }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
  } catch {}

  // ── 2. Detect URL type and resolve to canonical audio/transcript ──────────
  const urlType = detectUrlType(url);
  let resolvedAudioUrl: string | null = null;
  let resolvedEpisodeTitle = epTitleRaw || "";
  let resolvedShowName = showNameRaw || "";
  let resolvedTranscript: string | null = null;
  let resolvedHostNames: string[] = [];

  const jobId = `${urlType}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Save initial pending state
  const TIMEOUT_MS = 20 * 60 * 1000; // 20 min — covers long episodes
  await store.setJSON(jobId, {
    status: "pending", jobId, url, canonicalKey: canonical,
    episodeTitle: resolvedEpisodeTitle, showName: resolvedShowName,
    userId: userId || null,
    pendingTimeoutAt: Date.now() + TIMEOUT_MS,
  });

  // ── 3. YouTube path ───────────────────────────────────────────────────────
  if (urlType === "youtube") {
    const videoId = url.match(/(?:[?&]v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/)?.[1];
    if (!videoId) {
      await store.setJSON(jobId, { status: "error", jobId, error: "Could not extract YouTube video ID from URL" });
      return new Response(JSON.stringify({ jobId }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // Fetch metadata in parallel with first caption attempt
    const [meta] = await Promise.all([fetchYouTubeMetadata(videoId)]);
    if (meta.title && !resolvedEpisodeTitle) resolvedEpisodeTitle = meta.title;
    if (meta.channelTitle && !resolvedShowName) resolvedShowName = meta.channelTitle;

    // L1: Try OAuth captions if user has Google connected
    if (userId) {
      try {
        const ytTokenData = await usersStore.get(`youtube-${userId}`, { type: "json" }) as any;
        if (ytTokenData?.accessToken) {
          let token = ytTokenData.accessToken;
          // Refresh if expired
          if (ytTokenData.expiresAt && Date.now() > ytTokenData.expiresAt - 60000 && ytTokenData.refreshToken) {
            token = await refreshGoogleToken(ytTokenData.refreshToken) || token;
            if (token !== ytTokenData.accessToken) {
              try { await usersStore.setJSON(`youtube-${userId}`, { ...ytTokenData, accessToken: token, expiresAt: Date.now() + 3600000 }); } catch {}
            }
          }
          const oauthCaptions = await fetchYouTubeCaptionsOAuth(videoId, token);
          if (oauthCaptions) {
            console.log("[analyze] YT OAuth captions, length:", oauthCaptions.length);
            resolvedTranscript = oauthCaptions;
          }
        }
      } catch {}
    }

    // L2: Timedtext (unofficial, no auth) — if OAuth didn't work
    if (!resolvedTranscript) {
      const timedtext = await fetchYouTubeCaptionsNoAuth(videoId);
      if (timedtext) {
        console.log("[analyze] YT timedtext captions, length:", timedtext.length);
        resolvedTranscript = timedtext;
      }
    }

    // If we have a transcript, save and return — no Railway needed
    if (resolvedTranscript) {
      await store.setJSON(jobId, {
        status: "transcribed", jobId, url, canonicalKey: canonical,
        episodeTitle: resolvedEpisodeTitle, showName: resolvedShowName,
        transcript: resolvedTranscript,
      });
      return new Response(JSON.stringify({ jobId }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // Quick iTunes check before committing to slow Railway yt-dlp
    // Many YouTube podcast channels have RSS feeds — find it first
    const channelForItunes = resolvedShowName || meta.channelTitle || "";
    if (channelForItunes) {
      try {
        const itunesQuickRes = await fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(channelForItunes)}&media=podcast&entity=podcast&limit=5`,
          { signal: AbortSignal.timeout(6000) }
        );
        if (itunesQuickRes.ok) {
          const itunesQuick = await itunesQuickRes.json() as any;
          const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
          const normCh = normalise(channelForItunes);
          const bestQuick = (itunesQuick.results || []).find((r: any) => {
            const n = normalise(r.collectionName || r.trackName || "");
            return n.includes(normCh) || normCh.includes(n);
          });
          if (bestQuick?.feedUrl) {
            console.log(`[analyze] iTunes quick-path found before Railway: ${bestQuick.collectionName}`);
            // Try to auto-match the YouTube video title to an episode in the RSS feed
            const showNameForFallback = bestQuick.collectionName || channelForItunes;
            const showArtworkForFallback = bestQuick.artworkUrl600 || bestQuick.artworkUrl100 || "";
            let autoMatchedAudioUrl: string | null = null;
            if (resolvedEpisodeTitle) {
              try {
                const feedRes = await fetch(bestQuick.feedUrl, {
                  headers: { "User-Agent": "Podlens/1.0 (+https://podlens.app)" },
                  signal: AbortSignal.timeout(8000),
                });
                if (feedRes.ok) {
                  const feedXml = await feedRes.text();
                  const normTitle = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
                  const normYt = normTitle(resolvedEpisodeTitle);
                  const items = feedXml.match(/<item[\s\S]*?<\/item>/g) || [];
                  for (const item of items.slice(0, 30)) {
                    const tMatch = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
                    const epTitle = tMatch?.[1]?.trim() || "";
                    const normEp = normTitle(epTitle);
                    // Match using first 40 chars or shared 8-char substring (handles show branding appended to YouTube titles)
                    const ytPrefix = normYt.slice(0, 40);
                    const epPrefix = normEp.slice(0, 40);
                    const hasMatch = normEp.includes(ytPrefix) || normYt.includes(epPrefix) ||
                      (normEp.length > 8 && normYt.includes(normEp.slice(0, Math.min(normEp.length, 40))));
                    if (normEp && normYt && hasMatch) {
                      const enclosure = item.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
                      const audioUrl = enclosure?.[1] || "";
                      if (audioUrl) {
                        autoMatchedAudioUrl = audioUrl;
                        if (!resolvedEpisodeTitle) resolvedEpisodeTitle = epTitle;
                        console.log(`[analyze] iTunes auto-matched episode: ${epTitle}`);
                        break;
                      }
                    }
                  }
                }
              } catch {}
            }
            if (autoMatchedAudioUrl) {
              // Proceed directly to transcription — no picker needed
              resolvedAudioUrl = autoMatchedAudioUrl;
              resolvedShowName = resolvedShowName || showNameForFallback;
            } else {
              // No title match — just use the latest episode from the feed (seamless UX)
              try {
                const latestFeedRes = await fetch(bestQuick.feedUrl, {
                  headers: { "User-Agent": "Podlens/1.0 (+https://podlens.app)" },
                  signal: AbortSignal.timeout(8000),
                });
                if (latestFeedRes.ok) {
                  const latestXml = await latestFeedRes.text();
                  const latestItems = latestXml.match(/<item[\s\S]*?<\/item>/g) || [];
                  for (const item of latestItems.slice(0, 5)) {
                    const enc = item.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
                    if (enc?.[1]) {
                      resolvedAudioUrl = enc[1];
                      const tMatch = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
                      if (tMatch?.[1] && !resolvedEpisodeTitle) resolvedEpisodeTitle = tMatch[1].trim();
                      resolvedShowName = resolvedShowName || showNameForFallback;
                      console.log(`[analyze] iTunes fallback — using latest episode: ${resolvedEpisodeTitle}`);
                      break;
                    }
                  }
                }
              } catch {}
            }
          }
        }
      } catch {}
    }

    // If auto-matched from RSS, skip Railway entirely and fall through to AssemblyAI
    if (resolvedAudioUrl) {
      // continue below to section 8 (AssemblyAI)
    } else {

    // L3: Railway yt-dlp (client rotation: ios → android → web → mweb)
    const audioServiceUrl = Netlify.env.get("AUDIO_SERVICE_URL");
    const secret = Netlify.env.get("YOUTUBE_SERVICE_SECRET");

    const railwayWork = (async () => {
      if (!audioServiceUrl) {
        await store.setJSON(jobId, { status: "error", jobId, error: "Audio extraction service not configured. Try connecting your Google account for instant YouTube analysis." });
        return;
      }
      // Client rotation: ios → android → web → mweb → tv
      // Stop early on definitive errors (private/unavailable), retry on bot-detection
      const clients = ["ios", "android", "web", "mweb", "tv"];
      let lastError = "";
      let lastCode = "";

      for (const client of clients) {
        try {
          console.log(`[analyze] Railway attempt client=${client}`);
          const extractRes = await fetch(`${audioServiceUrl}/extract`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${secret}` },
            body: JSON.stringify({ url, ytClient: client }),
            signal: AbortSignal.timeout(120000),
          });
          const extracted = await extractRes.json() as any;

          // Success: captions returned
          if (extracted.success && extracted.transcript) {
            console.log(`[analyze] captions success client=${client}`);
            await store.setJSON(jobId, {
              status: "transcribed", jobId, url, canonicalKey: canonical,
              episodeTitle: resolvedEpisodeTitle || extracted.metadata?.title || "",
              showName: resolvedShowName || extracted.metadata?.channelTitle || "",
              transcript: extracted.transcript,
            });
            return;
          }

          // Success: audio returned — upload to AssemblyAI
          if (extracted.success && extracted.audioData) {
            console.log(`[analyze] audio success client=${client}, uploading to AssemblyAI`);
            const aaiKey = Netlify.env.get("ASSEMBLYAI_API_KEY") || "";
            const { id: transcriptId } = await uploadAndTranscribe(aaiKey, Buffer.from(extracted.audioData, "base64"));
            await store.setJSON(jobId, {
              status: "transcribing", jobId, url, canonicalKey: canonical,
              episodeTitle: resolvedEpisodeTitle || extracted.metadata?.title || "",
              showName: resolvedShowName || "",
              hostNames: resolvedHostNames,
              transcriptId,
              createdAt: Date.now(),
              pendingTimeoutAt: Date.now() + TIMEOUT_MS,
            });
            return;
          }

          // Definitive failures — don't retry with other clients
          lastError = extracted.error || `Client ${client} returned no data`;
          lastCode = extracted.code || "";
          console.log(`[analyze] client ${client} failed: code=${lastCode} error=${lastError}`);

          if (lastCode === "PRIVATE_VIDEO" || lastCode === "UNAVAILABLE") {
            break; // No point trying other clients
          }
          // BOT_DETECTED / EXTRACTION_FAILED → try next client

        } catch (e: any) {
          lastError = e.message;
          lastCode = "NETWORK_ERROR";
          console.warn(`[analyze] client ${client} threw:`, e.message);
        }
      }

      // All clients exhausted — before giving up, try iTunes/Apple Podcasts fallback
      // Many YouTube podcast channels also have RSS feeds via Apple Podcasts
      const channelName = resolvedShowName || meta.channelTitle || "";
      if (channelName && lastCode !== "PRIVATE_VIDEO" && lastCode !== "UNAVAILABLE") {
        try {
          console.log(`[analyze] YouTube failed, trying iTunes fallback for channel: ${channelName}`);
          const itunesRes = await fetch(
            `https://itunes.apple.com/search?term=${encodeURIComponent(channelName)}&media=podcast&entity=podcast&limit=5`,
            { signal: AbortSignal.timeout(8000) }
          );
          if (itunesRes.ok) {
            const itunesData = await itunesRes.json() as any;
            const results = itunesData.results || [];
            // Find best match — channel name similarity check
            const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
            const normChannel = normalise(channelName);
            const best = results.find((r: any) => {
              const normName = normalise(r.collectionName || r.trackName || "");
              return normName.includes(normChannel) || normChannel.includes(normName);
            });

            if (best?.feedUrl) {
              console.log(`[analyze] iTunes fallback found: ${best.collectionName} → ${best.feedUrl}`);
              // Try auto-match before showing picker
              let postRailwayAudioUrl: string | null = null;
              if (resolvedEpisodeTitle) {
                try {
                  const feedRes2 = await fetch(best.feedUrl, { headers: { "User-Agent": "Podlens/1.0 (+https://podlens.app)" }, signal: AbortSignal.timeout(8000) });
                  if (feedRes2.ok) {
                    const feedXml2 = await feedRes2.text();
                    const normT = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
                    const normYt2 = normT(resolvedEpisodeTitle);
                    const items2 = feedXml2.match(/<item[\s\S]*?<\/item>/g) || [];
                    for (const item2 of items2.slice(0, 30)) {
                      const tMatch2 = item2.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
                      const epTitle2 = tMatch2?.[1]?.trim() || "";
                      const normEp2 = normT(epTitle2);
                      const hasMatch2 = normEp2.includes(normYt2.slice(0, 40)) || normYt2.includes(normEp2.slice(0, 40)) ||
                        (normEp2.length > 8 && normYt2.includes(normEp2.slice(0, Math.min(normEp2.length, 40))));
                      if (normEp2 && normYt2 && hasMatch2) {
                        const enc2 = item2.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
                        if (enc2?.[1]) { postRailwayAudioUrl = enc2[1]; break; }
                      }
                    }
                  }
                } catch {}
              }
              if (postRailwayAudioUrl) {
                // Auto-matched — submit directly to AssemblyAI from within background job
                const aaiKeyBg = Netlify.env.get("ASSEMBLYAI_API_KEY");
                if (aaiKeyBg) {
                  try {
                    const { id: bgTranscriptId } = await submitTranscription(aaiKeyBg, postRailwayAudioUrl, { timeout: 30000 });
                    await store.setJSON(jobId, {
                      status: "transcribing", jobId, url, canonicalKey: canonical,
                      episodeTitle: resolvedEpisodeTitle,
                      showName: resolvedShowName || best.collectionName || channelName,
                      hostNames: resolvedHostNames,
                      transcriptId: bgTranscriptId,
                      createdAt: Date.now(),
                      pendingTimeoutAt: Date.now() + TIMEOUT_MS,
                    });
                    return;
                  } catch {}
                }
              }
              // No title match — use latest episode from feed (seamless UX, no picker)
              try {
                const latestRes2 = await fetch(best.feedUrl, {
                  headers: { "User-Agent": "Podlens/1.0 (+https://podlens.app)" },
                  signal: AbortSignal.timeout(8000),
                });
                if (latestRes2.ok) {
                  const latestXml2 = await latestRes2.text();
                  const items3 = latestXml2.match(/<item[\s\S]*?<\/item>/g) || [];
                  for (const item3 of items3.slice(0, 5)) {
                    const enc3 = item3.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
                    if (enc3?.[1]) {
                      const aaiKey3 = Netlify.env.get("ASSEMBLYAI_API_KEY");
                      if (aaiKey3) {
                        const tMatch3 = item3.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
                        const epTitle3 = tMatch3?.[1]?.trim() || "";
                        console.log(`[analyze] Post-Railway fallback — using latest episode: ${epTitle3}`);
                        const { id: latestTid } = await submitTranscription(aaiKey3, enc3[1], { timeout: 30000 });
                        await store.setJSON(jobId, {
                          status: "transcribing", jobId, url, canonicalKey: canonical,
                          episodeTitle: resolvedEpisodeTitle || epTitle3,
                          showName: resolvedShowName || best.collectionName || channelName,
                          hostNames: resolvedHostNames,
                          transcriptId: latestTid,
                          createdAt: Date.now(),
                          pendingTimeoutAt: Date.now() + TIMEOUT_MS,
                        });
                        return;
                      }
                    }
                  }
                }
              } catch {}
              // If even latest episode extraction fails, continue to next fallback

            }
          }
        } catch (e: any) {
          console.warn("[analyze] iTunes fallback failed:", e.message);
        }
      }

      // ── Last resort: broader iTunes search using episode title keywords ──
      // Channel name may not match a podcast, but the episode title might find it
      if (lastCode !== "PRIVATE_VIDEO" && resolvedEpisodeTitle) {
        try {
          // Extract meaningful keywords from title (skip common words)
          const titleWords = resolvedEpisodeTitle.replace(/[^a-zA-Z0-9\s]/g, " ").split(/\s+/).filter((w: string) => w.length > 3);
          const searchQuery = titleWords.slice(0, 5).join(" ");
          if (searchQuery.length > 8) {
            console.log(`[analyze] Last-resort iTunes search by title keywords: ${searchQuery}`);
            const lastRes = await fetch(
              `https://itunes.apple.com/search?term=${encodeURIComponent(searchQuery)}&media=podcast&entity=podcastEpisode&limit=5`,
              { signal: AbortSignal.timeout(8000) }
            );
            if (lastRes.ok) {
              const lastData = await lastRes.json() as any;
              for (const ep of (lastData.results || [])) {
                if (ep.episodeUrl || ep.feedUrl) {
                  const audioUrl = ep.episodeUrl || "";
                  if (audioUrl && /\.(mp3|m4a|aac)/i.test(audioUrl)) {
                    console.log(`[analyze] Last-resort found episode audio: ${ep.trackName} → ${audioUrl}`);
                    const aaiKey = Netlify.env.get("ASSEMBLYAI_API_KEY");
                    if (aaiKey) {
                      const { id: lrTranscriptId } = await submitTranscription(aaiKey, audioUrl, { timeout: 30000 });
                      await store.setJSON(jobId, {
                        status: "transcribing", jobId, url, canonicalKey: canonical,
                        episodeTitle: resolvedEpisodeTitle || ep.trackName || "",
                        showName: resolvedShowName || ep.collectionName || "",
                        hostNames: resolvedHostNames,
                        transcriptId: lrTranscriptId,
                        videoId: url.match(/(?:[?&]v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/)?.[1] || null,
                        createdAt: Date.now(),
                        pendingTimeoutAt: Date.now() + TIMEOUT_MS,
                      });
                      return; // Success — analysis will proceed via status polling
                    }
                  }
                }
              }
            }
          }
        } catch (e: any) {
          console.warn("[analyze] Last-resort title search failed:", e.message);
        }
      }

      // Truly no options left — include videoId so frontend can still embed the player
      const videoId = url.match(/(?:[?&]v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/)?.[1] || null;
      const userMessage = lastCode === "PRIVATE_VIDEO"
        ? "This video is private and cannot be analyzed."
        : lastCode === "AGE_RESTRICTED"
        ? "This video is age-restricted. Connect your Google account to analyze it."
        : lastCode === "NETWORK_ERROR"
        ? "Audio extraction service is temporarily unavailable. Please try again in a few minutes."
        : "We couldn't extract the transcript for this video. Connect your Google account for reliable YouTube analysis.";

      await store.setJSON(jobId, {
        status: "error", jobId,
        error: userMessage,
        code: lastCode,
        videoId,
        episodeTitle: resolvedEpisodeTitle,
        showName: resolvedShowName,
        suggestion: "connect_google",
      });
    })();

    context.waitUntil(railwayWork);
    return new Response(JSON.stringify({ jobId }), { status: 200, headers: { "Content-Type": "application/json" } });
    } // end else (Railway path)
  }

  // ── 3b. Spotify episode path ──────────────────────────────────────────────
  // Try: Spotify API (if user connected) → RSS via Podchaser/iTunes → direct
  if (urlType === "spotify") {
    const spEpId = url.match(/spotify\.com\/episode\/([a-zA-Z0-9]+)/)?.[1];
    let resolved = { audioUrl: null as string | null, episodeTitle: "", showName: "", hostNames: [] as string[] };

    // L1: If user has Spotify connected, use the Web API
    if (userId) {
      try {
        // Try to get episode from Spotify API
        const spToken = await (async () => {
          try {
            const spData = await usersStore.get(`spotify-${userId}`, { type: "json" }) as any;
            return spData?.accessToken || null;
          } catch { return null; }
        })();
        if (spToken && spEpId) {
          const epRes = await fetch(`https://api.spotify.com/v1/episodes/${spEpId}?market=US`, {
            headers: { Authorization: `Bearer ${spToken}` },
            signal: AbortSignal.timeout(8000),
          });
          if (epRes.ok) {
            const ep = await epRes.json() as any;
            if (!resolvedEpisodeTitle) resolvedEpisodeTitle = ep.name || "";
            if (!resolvedShowName) resolvedShowName = ep.show?.name || "";
            // Spotify doesn't give direct audio URLs but the RSS feed is often in the show
            const showRss = ep.show?.external_urls?.spotify || "";
            if (ep.show?.name) {
              const rssResolved = await resolveRssFeedToAudio(
                `https://itunes.apple.com/search?term=${encodeURIComponent(ep.show.name)}&media=podcast&limit=1`
              ).catch(() => ({ audioUrl: null, episodeTitle: "", showName: "", hostNames: [] as string[] }));
              if (rssResolved.audioUrl) resolved = rssResolved;
            }
          }
        }
      } catch(e: any) { console.warn("[analyze] Spotify API failed:", e.message); }
    }

    // L2: iTunes search for the show → get RSS → find episode by title
    if (!resolved.audioUrl && spEpId) {
      try {
        // Spotify canonical key exists, try iTunes lookup
        const itunesRes = await fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(resolvedShowName || "podcast")}&media=podcast&limit=3`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (itunesRes.ok) {
          const itunesData = await itunesRes.json() as any;
          const feedUrl = itunesData.results?.[0]?.feedUrl;
          if (feedUrl) {
            const rssResult = await resolveRssFeedToAudio(feedUrl);
            if (rssResult.audioUrl) resolved = rssResult;
          }
        }
      } catch(e: any) { console.warn("[analyze] iTunes fallback for Spotify failed:", e.message); }
    }

    if (resolved.audioUrl) {
      resolvedAudioUrl = resolved.audioUrl;
      if (!resolvedEpisodeTitle) resolvedEpisodeTitle = resolved.episodeTitle;
      if (!resolvedShowName) resolvedShowName = resolved.showName;
      resolvedHostNames = resolved.hostNames || [];
    } else {
      // Can't resolve — tell user to paste the RSS or audio URL directly
      await store.setJSON(jobId, {
        status: "error", jobId,
        error: "Could not resolve Spotify episode to audio. Try pasting the show's RSS feed URL or a direct episode audio link.",
        code: "SPOTIFY_UNRESOLVED",
      });
      return new Response(JSON.stringify({ jobId }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  }

  // ── 4. Apple Podcasts path ────────────────────────────────────────────────
  if (urlType === "apple") {
    const resolved = await resolveApplePodcastsUrl(url);
    if (resolved.audioUrl) {
      resolvedAudioUrl = resolved.audioUrl;
      if (!resolvedEpisodeTitle) resolvedEpisodeTitle = resolved.episodeTitle;
      if (!resolvedShowName) resolvedShowName = resolved.showName;
    } else {
      await store.setJSON(jobId, { status: "error", jobId, error: "Could not resolve Apple Podcasts URL to an audio file. Try pasting the direct episode URL." });
      return new Response(JSON.stringify({ jobId }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  }

  // ── 5. RSS feed path ──────────────────────────────────────────────────────
  if (urlType === "rss") {
    const resolved = await resolveRssFeedToAudio(url);
    if (resolved.audioUrl) {
      resolvedAudioUrl = resolved.audioUrl;
      if (!resolvedEpisodeTitle) resolvedEpisodeTitle = resolved.episodeTitle;
      if (!resolvedShowName) resolvedShowName = resolved.showName;
      resolvedHostNames = resolved.hostNames || [];
    } else {
      // RSS feed failed — try iTunes lookup as fallback (feed may have moved)
      const slugMatch = url.match(/\/([^\/\?#]+)(?:\?|#|$)/);
      const searchTerm = (slugMatch?.[1] || "").replace(/[-_]/g, " ").trim();
      if (searchTerm) {
        try {
          console.log(`[analyze] RSS feed failed, trying iTunes fallback for: ${searchTerm}`);
          const itunesRes = await fetch(
            `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&media=podcast&entity=podcast&limit=3`,
            { signal: AbortSignal.timeout(8000) }
          );
          if (itunesRes.ok) {
            const itunesData = await itunesRes.json() as any;
            for (const result of (itunesData.results || [])) {
              if (result.feedUrl) {
                const retryResolved = await resolveRssFeedToAudio(result.feedUrl);
                if (retryResolved.audioUrl) {
                  resolvedAudioUrl = retryResolved.audioUrl;
                  if (!resolvedEpisodeTitle) resolvedEpisodeTitle = retryResolved.episodeTitle;
                  if (!resolvedShowName) resolvedShowName = retryResolved.showName || result.collectionName || "";
                  resolvedHostNames = retryResolved.hostNames || [];
                  console.log(`[analyze] iTunes fallback success: ${resolvedShowName} via ${result.feedUrl}`);
                  break;
                }
              }
            }
          }
        } catch (e: any) {
          console.warn(`[analyze] iTunes RSS fallback failed:`, e.message);
        }
      }
      if (!resolvedAudioUrl) {
        await store.setJSON(jobId, { status: "error", jobId, error: "Could not find audio in the RSS feed. The feed may have moved or been removed." });
        return new Response(JSON.stringify({ jobId }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
    }
  }

  // ── 6. Direct audio URL path ──────────────────────────────────────────────
  if (urlType === "audio") {
    resolvedAudioUrl = url;
  }

  // ── 7. Unknown URL — try RSS resolver as best guess ───────────────────────
  if (urlType === "unknown" && !resolvedAudioUrl) {
    const resolved = await resolveRssFeedToAudio(url);
    if (resolved.audioUrl) {
      resolvedAudioUrl = resolved.audioUrl;
      if (!resolvedEpisodeTitle) resolvedEpisodeTitle = resolved.episodeTitle;
      if (!resolvedShowName) resolvedShowName = resolved.showName;
      resolvedHostNames = resolved.hostNames || [];
    } else {
      resolvedAudioUrl = url; // pass through and let AssemblyAI try
    }
  }

  // ── 8. Submit to AssemblyAI ───────────────────────────────────────────────
  const assemblyKey = Netlify.env.get("ASSEMBLYAI_API_KEY");
  if (!assemblyKey) {
    await store.setJSON(jobId, { status: "error", jobId, error: "Transcription service not configured." });
    return new Response(JSON.stringify({ jobId }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  let aaiData: { id: string };
  try {
    aaiData = await submitTranscription(assemblyKey, resolvedAudioUrl, { timeout: 30000 });
  } catch (e: any) {
    await store.setJSON(jobId, { status: "error", jobId, error: e.message || "Transcription service error" });
    return new Response(JSON.stringify({ jobId }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  await store.setJSON(jobId, {
    status: "transcribing", jobId, url, canonicalKey: canonical,
    episodeTitle: resolvedEpisodeTitle, showName: resolvedShowName,
    hostNames: resolvedHostNames,
    transcriptId: aaiData.id,
    createdAt: Date.now(),
    // pendingTimeoutAt: used by status.mts to detect stuck jobs
    pendingTimeoutAt: Date.now() + TIMEOUT_MS,
  });

  return new Response(JSON.stringify({ jobId }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config: Config = { path: "/api/analyze" };
