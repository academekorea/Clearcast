import { getStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";

interface ShowMeta {
  showName?: string;
  publisher?: string;
  channelName?: string;
  episodesAnalyzed?: number;
  biasLeftPct?: number;
  biasCenterPct?: number;
  biasRightPct?: number;
}

function leanLabel(leftPct: number, centerPct: number, rightPct: number): { text: string; bg: string; color: string } {
  const diff = Math.abs(leftPct - rightPct);
  if (diff < 20) return { text: "Mostly balanced", bg: "#d4edda", color: "#155724" };
  if (diff < 40) return { text: "Lightly one-sided", bg: "#fff3cd", color: "#856404" };
  if (diff < 60) return { text: "Moderately biased", bg: "#fff3cd", color: "#856404" };
  if (diff < 80) return { text: "Heavily one-sided", bg: "#f8d7da", color: "#721c24" };
  return { text: "Extremely one-sided", bg: "#f8d7da", color: "#721c24" };
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderWidget(show: ShowMeta): string {
  const name = escapeHtml(show.showName || "Unknown Show");
  const publisher = escapeHtml(show.publisher || show.channelName || "");
  const episodes = show.episodesAnalyzed || 0;
  const left = show.biasLeftPct || 0;
  const center = show.biasCenterPct || 0;
  const right = show.biasRightPct || 0;
  const lean = leanLabel(left, center, right);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name} — Podlens Bias Widget</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:transparent;">
<div style="width:380px;height:80px;box-sizing:border-box;padding:10px 14px;background:#fff;border:1px solid #e0ddd8;border-radius:6px;display:flex;flex-direction:column;justify-content:space-between;position:relative;">
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
    <div style="min-width:0;flex:1;">
      <div style="font-size:14px;font-weight:700;color:#1a1a1a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div>
      <div style="font-size:12px;color:#666;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;">${publisher}${publisher && episodes ? " · " : ""}${episodes ? episodes + " episode" + (episodes !== 1 ? "s" : "") + " analyzed" : ""}</div>
    </div>
    <span style="flex-shrink:0;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;background:${lean.bg};color:${lean.color};white-space:nowrap;">${lean.text}</span>
  </div>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;">
    <div style="display:flex;align-items:center;gap:6px;">
      <div style="width:130px;height:8px;border-radius:4px;overflow:hidden;display:flex;background:#eee;">
        <div style="width:${left}%;height:100%;background:#E24B4A;"></div>
        <div style="width:${center}%;height:100%;background:#D1CFC9;"></div>
        <div style="width:${right}%;height:100%;background:#378ADD;"></div>
      </div>
      <span style="font-size:10px;color:#999;">${left}% / ${center}% / ${right}%</span>
    </div>
    <a href="https://podlens.app" target="_blank" rel="noopener" style="font-size:10px;color:#999;text-decoration:none;">Powered by <strong style="color:#0f2027;">Podlens</strong></a>
  </div>
</div>
</body>
</html>`;
}

function renderNotFound(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Show not found — Podlens</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:transparent;">
<div style="width:380px;height:80px;box-sizing:border-box;padding:14px;background:#fff;border:1px solid #e0ddd8;border-radius:6px;display:flex;flex-direction:column;align-items:center;justify-content:center;">
  <div style="font-size:14px;color:#1a1a1a;font-weight:600;">Show not found</div>
  <div style="font-size:12px;color:#666;margin-top:4px;">This show hasn't been analyzed yet on <a href="https://podlens.app" target="_blank" rel="noopener" style="color:#378ADD;text-decoration:none;font-weight:500;">Podlens</a></div>
</div>
</body>
</html>`;
}

export default async function(req: Request, context: Context) {
  const slug = context.params?.slug;
  if (!slug) {
    return new Response(renderNotFound(), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "ALLOWALL" },
    });
  }

  const store = getStore({ name: "podlens-cache", consistency: "eventual" });

  let show: ShowMeta | null = null;

  // Try primary key first, then YouTube variant
  for (const key of [`show-meta-${slug}`, `show-meta-youtube-${slug}`]) {
    try {
      const raw = await store.get(key);
      if (raw) {
        show = JSON.parse(raw) as ShowMeta;
        break;
      }
    } catch {
      // continue to next key
    }
  }

  if (!show) {
    return new Response(renderNotFound(), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "ALLOWALL" },
    });
  }

  return new Response(renderWidget(show), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "X-Frame-Options": "ALLOWALL",
    },
  });
}

export const config = { path: "/embed/show/:slug" };
