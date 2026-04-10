import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

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
  if (/spotify\.com/.test(url)) return "spotify";
  if (/podcasts\.apple\.com/.test(url)) return "apple";
  if (/\.(mp3|m4a|ogg|wav|aac|opus)(\?|$)/i.test(url) || /podtrac|pdst\.fm|blubrry|audio/.test(url)) return "audio";
  if (/\.(xml|rss)(\?|$)/i.test(url) || /feeds\.|\/feed|\/rss/.test(url)) return "rss";
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
async function resolveRssFeedToAudio(feedUrl: string): Promise<{ audioUrl: string | null; episodeTitle: string; showName: string }> {
  const empty = { audioUrl: null, episodeTitle: "", showName: "" };
  try {
    const res = await fetch(feedUrl, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Podlens/1.0 (podcast analysis; +https://podlens.app)" },
    });
    if (!res.ok) return empty;
    const xml = await res.text();

    // Extract show name
    const showName = xml.match(/<title>([^<]+)<\/title>/)?.[1]?.trim() || "";

    // Find latest episode enclosure (audio URL)
    const items = xml.split(/<item[\s>]/i);
    for (let i = 1; i < Math.min(items.length, 5); i++) {
      const item = items[i];
      // Try <enclosure> tag first
      const enclosure = item.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*(type=["']audio[^"']*["'])?/i);
      if (enclosure?.[1]) {
        const epTitle = item.match(/<title>([^<]+)<\/title>/)?.[1]?.trim() || "";
        return { audioUrl: enclosure[1], episodeTitle: epTitle, showName };
      }
      // Try media:content
      const media = item.match(/<media:content[^>]+url=["']([^"']+\.(?:mp3|m4a|ogg|wav))/i);
      if (media?.[1]) {
        const epTitle = item.match(/<title>([^<]+)<\/title>/)?.[1]?.trim() || "";
        return { audioUrl: media[1], episodeTitle: epTitle, showName };
      }
    }
    return { audioUrl: null, episodeTitle: "", showName };
  } catch { return empty; }
}

// ── YOUTUBE CAPTIONS — TIMEDTEXT (no auth) ───────────────────────────────────
async function fetchYouTubeCaptionsNoAuth(videoId: string): Promise<string | null> {
  const langs = ["en", "en-US", "en-GB", "en-AU"];
  for (const lang of langs) {
    try {
      const res = await fetch(
        `https://www.youtube.com/api/timedtext?lang=${lang}&v=${videoId}&fmt=srv3`,
        { signal: AbortSignal.timeout(12000) }
      );
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml || xml.length < 200) continue;
      const captions = (xml.match(/<text[^>]*>([^<]*)<\/text>/g) || [])
        .map(t => t.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").trim())
        .filter(Boolean).join(" ").trim();
      if (captions && captions.length > 500) return captions;
    } catch {}
  }
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

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await req.json();
  const { url, episodeTitle: epTitleRaw, showName: showNameRaw, userId } = body;
  if (!url) {
    return new Response(JSON.stringify({ error: "URL is required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const store = getStore("podlens-jobs");
  const usersStore = getStore("podlens-users");

  // ── 1. Canonical cache check (community-wide, permanent) ──────────────────
  const canonical = canonicalKey(url);
  const canonKey = `canon:${canonical}`;
  try {
    const cached = await store.get(canonKey, { type: "json" }) as any;
    if (cached?.status === "complete" && cached?.biasScore !== undefined) {
      console.log("[analyze] community cache hit:", canonical);
      // Increment community counter
      try {
        await store.setJSON(canonKey, { ...cached, analyzeCount: (cached.analyzeCount || 0) + 1, lastRequestedAt: Date.now() });
      } catch {}
      return new Response(JSON.stringify({ jobId: cached.jobId, fromCache: true, communityCount: cached.analyzeCount || 1 }), {
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

  const jobId = `${urlType}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Save initial pending state
  await store.setJSON(jobId, {
    status: "pending", jobId, url, canonicalKey: canonical,
    episodeTitle: resolvedEpisodeTitle, showName: resolvedShowName,
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

    // L3: Railway yt-dlp (client rotation: ios → android → web → mweb)
    const audioServiceUrl = Netlify.env.get("AUDIO_SERVICE_URL");
    const secret = Netlify.env.get("YOUTUBE_SERVICE_SECRET");

    const railwayWork = (async () => {
      if (!audioServiceUrl) {
        await store.setJSON(jobId, { status: "error", jobId, error: "Audio extraction service not configured. Try connecting your Google account for instant YouTube analysis." });
        return;
      }
      const clients = ["ios", "android", "web", "mweb"];
      let lastError = "";
      for (const client of clients) {
        try {
          console.log(`[analyze] Railway yt-dlp attempt, client: ${client}`);
          const extractRes = await fetch(`${audioServiceUrl}/extract`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${secret}` },
            body: JSON.stringify({ url, ytClient: client }),
            signal: AbortSignal.timeout(120000),
          });
          const extracted = await extractRes.json();
          if (extracted.success && extracted.transcript) {
            await store.setJSON(jobId, {
              status: "transcribed", jobId, url, canonicalKey: canonical,
              episodeTitle: resolvedEpisodeTitle || extracted.metadata?.title || "",
              showName: resolvedShowName || extracted.metadata?.channelTitle || "",
              transcript: extracted.transcript,
            });
            return;
          }
          if (extracted.success && extracted.audioData) {
            // Upload to AssemblyAI
            const uploadRes = await fetch("https://api.assemblyai.com/v2/upload", {
              method: "POST",
              headers: { "authorization": Netlify.env.get("ASSEMBLYAI_API_KEY") || "", "content-type": "application/octet-stream" },
              body: Buffer.from(extracted.audioData, "base64"),
            });
            const { upload_url } = await uploadRes.json();
            const transcriptRes = await fetch("https://api.assemblyai.com/v2/transcript", {
              method: "POST",
              headers: { "authorization": Netlify.env.get("ASSEMBLYAI_API_KEY") || "", "content-type": "application/json" },
              body: JSON.stringify({ audio_url: upload_url }),
            });
            const { id: transcriptId } = await transcriptRes.json();
            await store.setJSON(jobId, {
              status: "transcribing", jobId, url, canonicalKey: canonical,
              episodeTitle: resolvedEpisodeTitle || extracted.metadata?.title || "",
              showName: resolvedShowName || "",
              transcriptId,
            });
            return;
          }
          lastError = extracted.error || `Client ${client} returned no data`;
          console.log(`[analyze] Railway client ${client} failed:`, lastError);
        } catch (e: any) {
          lastError = e.message;
          console.log(`[analyze] Railway client ${client} threw:`, e.message);
        }
      }
      // All clients failed
      await store.setJSON(jobId, {
        status: "error", jobId,
        error: "YouTube analysis failed after all extraction methods. Try connecting your Google account for reliable YouTube analysis.",
        detail: lastError,
        suggestion: "connect_google",
      });
    })();

    context.waitUntil(railwayWork);
    return new Response(JSON.stringify({ jobId }), { status: 200, headers: { "Content-Type": "application/json" } });
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
    } else {
      await store.setJSON(jobId, { status: "error", jobId, error: "Could not find audio in the RSS feed. Make sure the feed contains episode audio files." });
      return new Response(JSON.stringify({ jobId }), { status: 200, headers: { "Content-Type": "application/json" } });
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
    } else {
      resolvedAudioUrl = url; // pass through and let AssemblyAI try
    }
  }

  // ── 8. Submit to AssemblyAI ───────────────────────────────────────────────
  const assemblyKey = Netlify.env.get("ASSEMBLYAI_API_KEY");
  const aaiRes = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: { authorization: assemblyKey!, "content-type": "application/json" },
    body: JSON.stringify({ audio_url: resolvedAudioUrl, speech_model: "universal-2" }),
  });

  if (!aaiRes.ok) {
    const err = await aaiRes.text();
    await store.setJSON(jobId, { status: "error", jobId, error: "Transcription service error: " + err });
    return new Response(JSON.stringify({ jobId }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  const aaiData = await aaiRes.json();
  await store.setJSON(jobId, {
    status: "transcribing", jobId, url, canonicalKey: canonical,
    episodeTitle: resolvedEpisodeTitle, showName: resolvedShowName,
    transcriptId: aaiData.id,
    createdAt: Date.now(),
  });

  return new Response(JSON.stringify({ jobId }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config: Config = { path: "/api/analyze" };
