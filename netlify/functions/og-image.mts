import { getStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Wrap text to fit within a max width (approximate char count per line). */
function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (lines.length >= maxLines) break;
    if (current.length + word.length + 1 > maxChars) {
      lines.push(current.trim());
      current = word;
    } else {
      current += (current ? " " : "") + word;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current.trim());
  }
  // Truncate last line if we ran out of room
  if (words.length > 0 && lines.length === maxLines) {
    const last = lines[maxLines - 1];
    if (last.length > maxChars) {
      lines[maxLines - 1] = last.slice(0, maxChars - 3) + "...";
    }
  }
  return lines;
}

/** Derive plain-English lean label from bias percentages. */
function leanLabel(leftPct: number, rightPct: number): { text: string; color: string } {
  const diff = Math.abs(leftPct - rightPct);
  if (diff < 20) return { text: "Mostly balanced", color: "#4CAF50" };
  if (diff < 40) return { text: "Lightly one-sided", color: "#FFA726" };
  if (diff < 60) return { text: "Moderately biased", color: "#FFA726" };
  if (diff < 80) return { text: "Heavily one-sided", color: "#EF5350" };
  return { text: "Extremely one-sided", color: "#EF5350" };
}

/** Compute bias percentages from biasScore if not directly available. */
function deriveBiasPercentages(job: any): { leftPct: number; centerPct: number; rightPct: number } {
  if (job.bias_left_pct != null && job.bias_right_pct != null) {
    return {
      leftPct: job.bias_left_pct,
      centerPct: job.bias_center_pct ?? (100 - job.bias_left_pct - job.bias_right_pct),
      rightPct: job.bias_right_pct,
    };
  }
  // Fall back to biasScore → percentage estimation
  const bs = job.biasScore ?? 0;
  let lp: number, rp: number;
  if (bs < -5) {
    lp = Math.round(30 + Math.abs(bs) * 0.45);
    rp = Math.max(5, Math.round(20 - Math.abs(bs) * 0.15));
  } else if (bs > 5) {
    rp = Math.round(30 + bs * 0.45);
    lp = Math.max(5, Math.round(20 - bs * 0.15));
  } else {
    lp = 20;
    rp = 20;
  }
  const cp = Math.max(5, 100 - lp - rp);
  return { leftPct: lp, centerPct: cp, rightPct: rp };
}

// ── Generic fallback card ────────────────────────────────────────────────────

function genericCard(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <rect width="1200" height="630" fill="#0c1a24"/>
  <text x="600" y="260" text-anchor="middle" font-family="Georgia, serif" font-size="56" letter-spacing="0.08em" fill="white">
    <tspan font-weight="400">POD</tspan><tspan font-weight="700">LENS</tspan>
  </text>
  <text x="600" y="320" text-anchor="middle" font-family="Inter, -apple-system, sans-serif" font-size="20" fill="white" fill-opacity="0.5">
    Know what you're actually listening to
  </text>
  <text x="600" y="560" text-anchor="middle" font-family="Inter, -apple-system, sans-serif" font-size="14" fill="white" fill-opacity="0.35">
    PODLENS.APP
  </text>
</svg>`;
}

// ── Analysis card ────────────────────────────────────────────────────────────

function analysisCard(job: any): string {
  const title = job.episodeTitle || "Podcast Episode";
  const showName = job.showName || "Unknown Show";
  const { leftPct, centerPct, rightPct } = deriveBiasPercentages(job);
  const lean = leanLabel(leftPct, rightPct);
  const hostTrust = job.dimensions?.hostCredibility?.score ?? job.host_trust_score ?? null;
  const flagsCount = Array.isArray(job.flags) ? job.flags.length : 0;

  // Title wrapping (max ~36 chars per line at 28px, max 3 lines)
  const titleLines = wrapText(title, 36, 3);
  const showNameSafe = escapeXml(showName.length > 50 ? showName.slice(0, 47) + "..." : showName);

  // Bias bar proportions (total bar width = 440px)
  const barWidth = 440;
  const total = leftPct + centerPct + rightPct || 100;
  const leftW = Math.round((leftPct / total) * barWidth);
  const centerW = Math.round((centerPct / total) * barWidth);
  const rightW = barWidth - leftW - centerW;

  // Layout positions
  const artworkX = 60;
  const artworkY = 100;
  const artworkSize = 148;
  const contentX = 260;
  const titleStartY = 130;

  // Title lines SVG
  const titleSvg = titleLines
    .map((line, i) => {
      const y = titleStartY + i * 36;
      return `<text x="${contentX}" y="${y}" font-family="Inter, -apple-system, sans-serif" font-size="28" font-weight="700" fill="white">${escapeXml(line)}</text>`;
    })
    .join("\n    ");

  const afterTitleY = titleStartY + titleLines.length * 36 + 8;

  // Build info chips below bias bar
  const chipY = afterTitleY + 110;
  const chips: string[] = [];
  let chipX = contentX;

  // Lean label pill
  const leanText = escapeXml(lean.text);
  const leanPillW = leanText.length * 8.5 + 24;
  chips.push(`
    <rect x="${chipX}" y="${chipY}" width="${leanPillW}" height="30" rx="15" fill="${lean.color}" opacity="0.9"/>
    <text x="${chipX + leanPillW / 2}" y="${chipY + 20}" text-anchor="middle" font-family="Inter, -apple-system, sans-serif" font-size="13" font-weight="600" fill="white">${leanText}</text>
  `);
  chipX += leanPillW + 14;

  // Host trust
  if (hostTrust != null) {
    const trustText = `Host trust: ${hostTrust}/100`;
    const trustW = trustText.length * 7.5 + 24;
    chips.push(`
    <rect x="${chipX}" y="${chipY}" width="${trustW}" height="30" rx="15" fill="white" fill-opacity="0.12"/>
    <text x="${chipX + trustW / 2}" y="${chipY + 20}" text-anchor="middle" font-family="Inter, -apple-system, sans-serif" font-size="13" font-weight="500" fill="white" fill-opacity="0.8">${escapeXml(trustText)}</text>
    `);
    chipX += trustW + 14;
  }

  // Flags count
  if (flagsCount > 0) {
    const flagText = `${flagsCount} flag${flagsCount > 1 ? "s" : ""}`;
    const flagW = flagText.length * 8 + 24;
    chips.push(`
    <rect x="${chipX}" y="${chipY}" width="${flagW}" height="30" rx="15" fill="white" fill-opacity="0.12"/>
    <text x="${chipX + flagW / 2}" y="${chipY + 20}" text-anchor="middle" font-family="Inter, -apple-system, sans-serif" font-size="13" font-weight="500" fill="white" fill-opacity="0.8">${escapeXml(flagText)}</text>
    `);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <clipPath id="artClip">
      <rect x="${artworkX}" y="${artworkY}" width="${artworkSize}" height="${artworkSize}" rx="16"/>
    </clipPath>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="#0c1a24"/>

  <!-- Artwork placeholder -->
  <rect x="${artworkX}" y="${artworkY}" width="${artworkSize}" height="${artworkSize}" rx="16" fill="#1a3a4a"/>
  <text x="${artworkX + artworkSize / 2}" y="${artworkY + artworkSize / 2 + 6}" text-anchor="middle" font-family="Inter, -apple-system, sans-serif" font-size="14" fill="white" fill-opacity="0.3">PODCAST</text>

  <!-- Episode title -->
  ${titleSvg}

  <!-- Show name -->
  <text x="${contentX}" y="${afterTitleY}" font-family="Inter, -apple-system, sans-serif" font-size="18" fill="white" fill-opacity="0.6">${showNameSafe}</text>

  <!-- Bias bar -->
  <g transform="translate(${contentX}, ${afterTitleY + 24})">
    <!-- Bar background -->
    <rect width="${barWidth}" height="14" rx="7" fill="white" fill-opacity="0.08"/>
    <!-- Left (red) -->
    <rect width="${leftW}" height="14" rx="${leftW > 0 ? 7 : 0}" fill="#E24B4A"/>
    <!-- Center (gray) -->
    <rect x="${leftW}" width="${centerW}" height="14" fill="#D1CFC9"/>
    <!-- Right (blue) -->
    <rect x="${leftW + centerW}" width="${rightW}" height="14" rx="${rightW > 0 ? 7 : 0}" fill="#378ADD"/>

    <!-- Rounded ends clipping -->
    <rect width="${barWidth}" height="14" rx="7" fill="none" stroke="#0c1a24" stroke-width="0"/>

    <!-- Labels below bar -->
    <text x="0" y="34" font-family="Inter, -apple-system, sans-serif" font-size="12" fill="#E24B4A">${leftPct}% left</text>
    <text x="${barWidth / 2}" y="34" text-anchor="middle" font-family="Inter, -apple-system, sans-serif" font-size="12" fill="#D1CFC9">${centerPct}% center</text>
    <text x="${barWidth}" y="34" text-anchor="end" font-family="Inter, -apple-system, sans-serif" font-size="12" fill="#378ADD">${rightPct}% right</text>
  </g>

  <!-- Info chips -->
  ${chips.join("")}

  <!-- Wordmark -->
  <text x="60" y="560" font-family="Georgia, serif" font-size="28" letter-spacing="0.08em" fill="white">
    <tspan font-weight="400">POD</tspan><tspan font-weight="700">LENS</tspan>
  </text>

  <!-- Footer URL -->
  <text x="1140" y="560" text-anchor="end" font-family="Inter, -apple-system, sans-serif" font-size="14" fill="white" fill-opacity="0.4">PODLENS.APP</text>

  <!-- Divider line -->
  <line x1="60" y1="520" x2="1140" y2="520" stroke="white" stroke-opacity="0.08" stroke-width="1"/>
</svg>`;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: Request, _context: Context) {
  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");

  const headers = {
    "Content-Type": "image/svg+xml",
    "Cache-Control": "public, max-age=86400",
  };

  if (!jobId) {
    return new Response(genericCard(), { status: 200, headers });
  }

  try {
    const store = getStore("podlens-jobs");
    const job = await store.get(jobId, { type: "json" }) as any;

    if (!job || job.status !== "complete") {
      return new Response(genericCard(), { status: 200, headers });
    }

    return new Response(analysisCard(job), { status: 200, headers });
  } catch (err) {
    console.error("[og-image] Error:", err);
    return new Response(genericCard(), { status: 200, headers });
  }
}

export const config = {
  path: "/api/og-image",
};
