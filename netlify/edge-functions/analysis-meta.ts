/**
 * analysis-meta.ts — Netlify Edge Function
 *
 * Intercepts GET /analysis/{jobId} before the SPA catch-all.
 * Social scrapers (Facebook, Twitter, LinkedIn, etc.) don't execute JS,
 * so they'd only see the generic fallback OG tags in index.html.
 *
 * This function:
 *  1. Detects scraper User-Agents
 *  2. For scrapers → fetches job data from Netlify Blobs and returns a
 *     minimal HTML page with per-analysis OG meta tags
 *  3. For real users → passes through to the SPA (index.html)
 */

import type { Context } from "@netlify/edge-functions";

// ── Bot / scraper detection ───────────────────────────────────────────────────

const BOT_PATTERNS = [
  "facebookexternalhit",
  "facebookcatalog",
  "twitterbot",
  "linkedinbot",
  "slackbot",
  "telegrambot",
  "whatsapp",
  "discordbot",
  "applebot",
  "googlebot",
  "bingbot",
  "duckduckbot",
  "pinterestbot",
  "redditbot",
  "tumblr",
  "vkshare",
  "w3c_validator",
  "iframely",
  "embedly",
  "outbrain",
  "quora link preview",
  "rogerbot",
  "showyoubot",
  "xing-contenttabreceiver",
  "developers.google.com/+/web/snippet",
];

function isScraper(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  return BOT_PATTERNS.some((p) => ua.includes(p));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + "...";
}

function biasDescription(job: Record<string, unknown>): string {
  const showName = String(job.show_name || job.showName || "");
  const lPct = (job.bias_left_pct as number | undefined) ?? 0;
  const rPct = (job.bias_right_pct as number | undefined) ?? 0;
  const diff = Math.abs(lPct - rPct);
  let lean: string;
  if (diff < 20) lean = "Mostly balanced";
  else if (lPct > rPct) lean = `Leans left (${lPct}% left)`;
  else lean = `Leans right (${rPct}% right)`;

  const trust = (job.host_trust_score as number | undefined) ?? (job.trustScore as number | undefined);
  const trustPart = trust != null ? ` · Trust score ${Math.round(trust)}/100` : "";

  return truncate(`${showName ? showName + " · " : ""}${lean}${trustPart}`, 200);
}

// ── Fallback HTML (used when job not found / not complete) ────────────────────

function fallbackHtml(jobId: string): string {
  return `<!DOCTYPE html>
<html>
<head>
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
<meta name="twitter:description" content="AI-powered bias analysis for podcasts. See how balanced your listening is.">
<meta name="twitter:image" content="https://podlens.app/og-image.png">
<meta http-equiv="refresh" content="0; url=https://podlens.app/analysis/${esc(jobId)}">
</head>
<body></body>
</html>`;
}

// ── Per-analysis HTML ─────────────────────────────────────────────────────────

function analysisHtml(jobId: string, job: Record<string, unknown>): string {
  const episodeTitle = String(job.episode_title || job.episodeTitle || "Podcast Episode Analysis");
  const showName = String(job.show_name || job.showName || "");
  const ogTitle = truncate(
    showName ? `${episodeTitle} — ${showName} | PodLens` : `${episodeTitle} | PodLens`,
    100
  );
  const ogDesc = biasDescription(job);
  const ogImage = `https://podlens.app/api/og-image?jobId=${encodeURIComponent(jobId)}`;
  const ogUrl = `https://podlens.app/analysis/${jobId}`;
  const lPct = (job.bias_left_pct as number | undefined) ?? 0;
  const rPct = (job.bias_right_pct as number | undefined) ?? 0;
  const cPct = (job.bias_center_pct as number | undefined) ?? (100 - lPct - rPct);
  const biasLabel =
    job.bias_label ||
    (Math.abs(lPct - rPct) < 20
      ? "Mostly Balanced"
      : lPct > rPct
      ? "Leans Left"
      : "Leans Right");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(ogTitle)}</title>

<!-- Open Graph -->
<meta property="og:site_name" content="PodLens">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/png">
<meta property="og:url" content="${esc(ogUrl)}">

<!-- Twitter / X -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@podlensapp">
<meta name="twitter:title" content="${esc(ogTitle)}">
<meta name="twitter:description" content="${esc(ogDesc)}">
<meta name="twitter:image" content="${esc(ogImage)}">

<!-- LinkedIn / extra -->
<meta name="description" content="${esc(ogDesc)}">
<meta property="article:author" content="PodLens">

<!-- Structured data -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": ${JSON.stringify(ogTitle)},
  "description": ${JSON.stringify(ogDesc)},
  "image": ${JSON.stringify(ogImage)},
  "url": ${JSON.stringify(ogUrl)},
  "publisher": {
    "@type": "Organization",
    "name": "PodLens",
    "url": "https://podlens.app"
  },
  "about": {
    "@type": "PodcastEpisode",
    "name": ${JSON.stringify(episodeTitle)},
    "partOfSeries": {
      "@type": "PodcastSeries",
      "name": ${JSON.stringify(showName)}
    }
  },
  "additionalProperty": [
    { "@type": "PropertyValue", "name": "biasLabel", "value": ${JSON.stringify(biasLabel)} },
    { "@type": "PropertyValue", "name": "leftPct", "value": ${lPct} },
    { "@type": "PropertyValue", "name": "centerPct", "value": ${cPct} },
    { "@type": "PropertyValue", "name": "rightPct", "value": ${rPct} }
  ]
}
</script>

<!-- Redirect real users (non-scrapers that somehow land here) to the SPA -->
<meta http-equiv="refresh" content="0; url=${esc(ogUrl)}">
</head>
<body>
<p>Redirecting to <a href="${esc(ogUrl)}">PodLens analysis</a>…</p>
</body>
</html>`;
}

// ── Edge function handler ─────────────────────────────────────────────────────

export default async function handler(req: Request, context: Context): Promise<Response> {
  const ua = req.headers.get("user-agent") || "";

  // Pass real users straight through to the SPA
  if (!isScraper(ua)) {
    return context.next();
  }

  // Extract jobId from /analysis/{jobId}
  const url = new URL(req.url);
  const segments = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  const jobId = segments[segments.length - 1];

  if (!jobId || jobId === "analysis") {
    return context.next();
  }

  try {
    // Netlify Blobs in edge functions — use the store name and env vars
    const storeUrl = Netlify.env.get("NETLIFY_BLOBS_CONTEXT");
    if (!storeUrl) {
      // No Blobs context available in edge (shouldn't happen in production)
      return new Response(fallbackHtml(jobId), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Use the Netlify Blobs REST API directly (works in any runtime)
    const siteId = Netlify.env.get("SITE_ID") || Netlify.env.get("NETLIFY_SITE_ID") || "";
    const token = Netlify.env.get("NETLIFY_BLOBS_TOKEN") || Netlify.env.get("TOKEN") || "";

    if (!siteId || !token) {
      return new Response(fallbackHtml(jobId), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Netlify Blobs REST endpoint
    const blobUrl = `https://api.netlify.com/api/v1/sites/${siteId}/blobs/podlens-jobs/${encodeURIComponent(jobId)}`;
    const blobRes = await fetch(blobUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!blobRes.ok) {
      return new Response(fallbackHtml(jobId), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const job = await blobRes.json() as Record<string, unknown>;

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
        "X-Robots-Tag": "index, follow",
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
