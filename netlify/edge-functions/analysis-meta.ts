/**
 * analysis-meta.ts — Netlify Edge Function
 * Intercepts /analysis/:jobId for social scrapers, injects per-analysis OG tags.
 * Real users pass through to the SPA unchanged.
 */

import type { Context } from "@netlify/edge-functions";
import { getStore } from "@netlify/blobs";

// ── Bot detection ─────────────────────────────────────────────────────────────

const BOT_PATTERNS = [
  "facebookexternalhit", "facebookcatalog", "twitterbot", "linkedinbot",
  "slackbot", "telegrambot", "whatsapp", "discordbot", "applebot",
  "googlebot", "bingbot", "duckduckbot", "pinterestbot", "redditbot",
  "tumblr", "vkshare", "iframely", "embedly", "outbrain", "rogerbot",
];

function isScraper(ua: string): boolean {
  const lower = ua.toLowerCase();
  return BOT_PATTERNS.some((p) => lower.includes(p));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 3) + "...";
}

function biasDesc(job: Record<string, unknown>): string {
  const show  = String(job.show_name  || job.showName  || "");
  const lPct  = (job.bias_left_pct   as number | undefined) ?? 0;
  const rPct  = (job.bias_right_pct  as number | undefined) ?? 0;
  const diff  = Math.abs(lPct - rPct);
  const lean  = diff < 20 ? "Mostly balanced"
              : lPct > rPct ? `Leans left (${lPct}% left)`
              : `Leans right (${rPct}% right)`;
  const trust = (job.host_trust_score as number | undefined)
              ?? (job.trustScore      as number | undefined);
  const tp    = trust != null ? ` · Trust score ${Math.round(trust)}/100` : "";
  return truncate(`${show ? show + " · " : ""}${lean}${tp}`, 200);
}

// ── HTML builders ─────────────────────────────────────────────────────────────

function fallbackHtml(jobId: string): string {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<title>PodLens — Bias Analysis</title>
<meta property="og:site_name" content="PodLens">
<meta property="og:type" content="website">
<meta property="og:title" content="PodLens — Podcast Bias Intelligence">
<meta property="og:description" content="AI-powered bias analysis for podcasts. See how balanced your listening is.">
<meta property="og:image" content="https://podlens.app/og-image.png">
<meta property="og:url" content="https://podlens.app/analysis/${esc(jobId)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="PodLens — Podcast Bias Intelligence">
<meta name="twitter:description" content="AI-powered bias analysis for podcasts.">
<meta name="twitter:image" content="https://podlens.app/og-image.png">
<meta http-equiv="refresh" content="0; url=https://podlens.app/analysis/${esc(jobId)}">
</head><body></body></html>`;
}

function analysisHtml(jobId: string, job: Record<string, unknown>): string {
  const episode = String(job.episode_title || job.episodeTitle || "Podcast Episode Analysis");
  const show    = String(job.show_name     || job.showName     || "");
  const title   = truncate(show ? `${episode} — ${show} | PodLens` : `${episode} | PodLens`, 100);
  const desc    = biasDesc(job);
  const image   = `https://podlens.app/api/og-image?jobId=${encodeURIComponent(jobId)}`;
  const url     = `https://podlens.app/analysis/${jobId}`;
  const lPct    = (job.bias_left_pct  as number | undefined) ?? 0;
  const rPct    = (job.bias_right_pct as number | undefined) ?? 0;
  const cPct    = (job.bias_center_pct as number | undefined) ?? (100 - lPct - rPct);
  const label   = String(job.bias_label || (Math.abs(lPct - rPct) < 20 ? "Mostly Balanced" : lPct > rPct ? "Leans Left" : "Leans Right"));

  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta property="og:site_name" content="PodLens">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/png">
<meta property="og:url" content="${esc(url)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@podlensapp">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<meta name="description" content="${esc(desc)}">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Article","headline":${JSON.stringify(title)},"description":${JSON.stringify(desc)},"image":${JSON.stringify(image)},"url":${JSON.stringify(url)},"publisher":{"@type":"Organization","name":"PodLens","url":"https://podlens.app"},"about":{"@type":"PodcastEpisode","name":${JSON.stringify(episode)},"partOfSeries":{"@type":"PodcastSeries","name":${JSON.stringify(show)}}},"additionalProperty":[{"@type":"PropertyValue","name":"biasLabel","value":${JSON.stringify(label)}},{"@type":"PropertyValue","name":"leftPct","value":${lPct}},{"@type":"PropertyValue","name":"centerPct","value":${cPct}},{"@type":"PropertyValue","name":"rightPct","value":${rPct}}]}
</script>
<meta http-equiv="refresh" content="0; url=${esc(url)}">
</head><body><p>Redirecting to <a href="${esc(url)}">PodLens analysis</a>…</p></body></html>`;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: Request, context: Context): Promise<Response> {
  const ua = req.headers.get("user-agent") || "";

  // Real users go straight to the SPA
  if (!isScraper(ua)) return context.next();

  // Extract jobId from /analysis/{jobId}
  const segments = new URL(req.url).pathname.replace(/^\/+|\/+$/g, "").split("/");
  const jobId = segments[segments.length - 1];
  if (!jobId || jobId === "analysis") return context.next();

  try {
    const store = getStore("podlens-jobs");
    const job = await store.get(jobId, { type: "json" }) as Record<string, unknown> | null;

    if (!job || (job.status !== "complete" && job.status !== "partial")) {
      return new Response(fallbackHtml(jobId), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response(analysisHtml(jobId, job), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    console.error("[analysis-meta]", err);
    return new Response(fallbackHtml(jobId), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}

export const config = { path: "/analysis/:jobId" };
