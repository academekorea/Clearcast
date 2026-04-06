import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

export default async (req: Request) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  if (req.method === "OPTIONS") {
    return new Response("", { status: 200, headers });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { url, userId, showName, episodeTitle } = body as any;

    if (!url) {
      return new Response(JSON.stringify({ error: "No URL provided" }), { status: 400, headers });
    }

    console.log("[analyze] Starting for URL:", url);

    const supabaseUrl = Netlify.env.get("SUPABASE_URL");
    const supabaseKey = Netlify.env.get("SUPABASE_SERVICE_KEY");
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Supabase not configured");
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── Resolve RSS to audio URL ──────────────────────────────────────────
    let audioUrl = url;
    let showTitle = showName || (new URL(url).hostname.replace("www.", ""));
    let epTitle = episodeTitle || "Latest Episode";

    const isRSS =
      url.includes("/feed") || url.includes("/rss") ||
      url.endsWith(".xml") || url.endsWith(".rss");

    if (isRSS) {
      console.log("[analyze] Fetching RSS feed...");
      const feedRes = await fetch(url, {
        headers: { "User-Agent": "Podlens/1.0" },
        signal: AbortSignal.timeout(8000),
      });
      const xml = await feedRes.text();

      const showMatch =
        xml.match(/<channel>[\s\S]{0,500}?<title><!\[CDATA\[([^\]]+)\]\]><\/title>/) ||
        xml.match(/<channel>[\s\S]{0,500}?<title>([^<]{3,100})<\/title>/);
      if (showMatch) showTitle = showMatch[1].trim();

      const epMatch =
        xml.match(/<item>[\s\S]{0,300}?<title><!\[CDATA\[([^\]]+)\]\]><\/title>/) ||
        xml.match(/<item>[\s\S]{0,300}?<title>([^<]{3,200})<\/title>/);
      if (epMatch) epTitle = epMatch[1].trim();

      const enclosure =
        xml.match(/<enclosure[^>]+url="([^"]+\.mp3[^"]*)"/i) ||
        xml.match(/<enclosure[^>]+url="([^"]+\.m4a[^"]*)"/i) ||
        xml.match(/<enclosure[^>]+url="([^"]+)"/i);
      if (enclosure) {
        audioUrl = enclosure[1].replace(/&amp;/g, "&");
        console.log("[analyze] Audio URL:", audioUrl.substring(0, 80));
      } else {
        throw new Error("No audio found in RSS feed");
      }
    }

    // ── Create job in Supabase ────────────────────────────────────────────
    const jobId = crypto.randomUUID();
    console.log("[analyze] Creating job:", jobId);

    const { error: insertError } = await supabase.from("analysis_queue").insert({
      id: jobId,
      user_id: userId || null,
      episode_url: audioUrl,
      show_name: showTitle,
      episode_title: epTitle,
      status: "transcribing",
      tier: "free",
      counts_toward_limit: true,
      priority: 5,
      queued_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
    });

    if (insertError) {
      console.error("[analyze] Insert error:", JSON.stringify(insertError));
      throw new Error("DB insert failed: " + insertError.message);
    }

    console.log("[analyze] Job created:", jobId);

    // ── Trigger background worker (fire-and-forget) ───────────────────────
    fetch("https://podlens.app/.netlify/functions/analyze-worker-background", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, audioUrl, showTitle, episodeTitle: epTitle, userId }),
    }).catch((e: any) => console.error("[analyze] Worker trigger error:", e?.message));

    return new Response(
      JSON.stringify({ jobId, status: "transcribing", show: showTitle }),
      { status: 200, headers }
    );

  } catch (err: any) {
    console.error("[analyze] Error:", err?.message);
    return new Response(
      JSON.stringify({ error: err?.message || "Unknown error" }),
      { status: 500, headers }
    );
  }
};

export const config: Config = { path: "/api/analyze" };
