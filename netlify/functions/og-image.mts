import { getStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";

// ── PNG generation (pure Node.js — no external image libs) ───────────────────

function crc32(buf: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  for (const byte of buf) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function uint32BE(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF]);
}

async function buildPng(width: number, height: number, pixels: Uint8Array): Promise<Uint8Array> {
  const { deflateSync } = await import("zlib");
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = y * (1 + width * 4) + 1 + x * 4;
      raw[dst] = pixels[src]; raw[dst+1] = pixels[src+1];
      raw[dst+2] = pixels[src+2]; raw[dst+3] = pixels[src+3];
    }
  }
  const compressed = deflateSync(raw, { level: 6 });
  const sig = new Uint8Array([137,80,78,71,13,10,26,10]);
  const makeChunk = (type: string, data: Uint8Array): Uint8Array => {
    const typeBytes = new TextEncoder().encode(type);
    const crcData = new Uint8Array(typeBytes.length + data.length);
    crcData.set(typeBytes); crcData.set(data, typeBytes.length);
    const crc = crc32(crcData);
    return new Uint8Array([...uint32BE(data.length), ...typeBytes, ...data, ...uint32BE(crc)]);
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = makeChunk('IDAT', compressed);
  return new Uint8Array([...sig, ...makeChunk('IHDR', ihdr), ...idat, ...makeChunk('IEND', new Uint8Array(0))]);
}

// ── Canvas pixel buffer ───────────────────────────────────────────────────────

class Canvas {
  buf: Uint8Array;
  w: number; h: number;

  constructor(w: number, h: number) {
    this.w = w; this.h = h;
    this.buf = new Uint8Array(w * h * 4);
  }

  setPixel(x: number, y: number, r: number, g: number, b: number, a = 255) {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.buf[i] = r; this.buf[i+1] = g; this.buf[i+2] = b; this.buf[i+3] = a;
  }

  fillRect(x: number, y: number, w: number, h: number, r: number, g: number, b: number, a = 255) {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) this.setPixel(x+dx, y+dy, r, g, b, a);
  }

  fillRoundRect(x: number, y: number, w: number, h: number, rx: number, r: number, g: number, b: number, a = 255) {
    this.fillRect(x + rx, y, w - rx * 2, h, r, g, b, a);
    this.fillRect(x, y + rx, rx, h - rx * 2, r, g, b, a);
    this.fillRect(x + w - rx, y + rx, rx, h - rx * 2, r, g, b, a);
    for (let cy = 0; cy < rx; cy++) {
      for (let cx2 = 0; cx2 < rx; cx2++) {
        if ((cx2 - rx) * (cx2 - rx) + (cy - rx) * (cy - rx) <= rx * rx) {
          this.setPixel(x + cx2, y + cy, r, g, b, a);
          this.setPixel(x + w - 1 - cx2, y + cy, r, g, b, a);
          this.setPixel(x + cx2, y + h - 1 - cy, r, g, b, a);
          this.setPixel(x + w - 1 - cx2, y + h - 1 - cy, r, g, b, a);
        }
      }
    }
  }

  drawBiasBar(x: number, y: number, w: number, h: number, lPct: number, cPct: number, rPct: number) {
    const lW = Math.round(w * lPct / 100);
    const cW = Math.round(w * cPct / 100);
    const rW = w - lW - cW;
    this.fillRect(x, y, lW, h, 0xE2, 0x4B, 0x4A);
    this.fillRect(x + lW, y, cW, h, 0xD1, 0xCF, 0xC9);
    this.fillRect(x + lW + cW, y, rW, h, 0x37, 0x8A, 0xDD);
  }

  static GLYPHS: Record<string, number[]> = {
    ' ':  [0,0,0,0,0,0,0],
    'A':  [0b01110,0b10001,0b10001,0b11111,0b10001,0b10001,0b10001],
    'B':  [0b11110,0b10001,0b10001,0b11110,0b10001,0b10001,0b11110],
    'C':  [0b01110,0b10001,0b10000,0b10000,0b10000,0b10001,0b01110],
    'D':  [0b11100,0b10010,0b10001,0b10001,0b10001,0b10010,0b11100],
    'E':  [0b11111,0b10000,0b10000,0b11110,0b10000,0b10000,0b11111],
    'F':  [0b11111,0b10000,0b10000,0b11110,0b10000,0b10000,0b10000],
    'G':  [0b01110,0b10001,0b10000,0b10111,0b10001,0b10001,0b01111],
    'H':  [0b10001,0b10001,0b10001,0b11111,0b10001,0b10001,0b10001],
    'I':  [0b01110,0b00100,0b00100,0b00100,0b00100,0b00100,0b01110],
    'J':  [0b00111,0b00010,0b00010,0b00010,0b10010,0b10010,0b01100],
    'K':  [0b10001,0b10010,0b10100,0b11000,0b10100,0b10010,0b10001],
    'L':  [0b10000,0b10000,0b10000,0b10000,0b10000,0b10000,0b11111],
    'M':  [0b10001,0b11011,0b10101,0b10001,0b10001,0b10001,0b10001],
    'N':  [0b10001,0b11001,0b10101,0b10011,0b10001,0b10001,0b10001],
    'O':  [0b01110,0b10001,0b10001,0b10001,0b10001,0b10001,0b01110],
    'P':  [0b11110,0b10001,0b10001,0b11110,0b10000,0b10000,0b10000],
    'Q':  [0b01110,0b10001,0b10001,0b10001,0b10101,0b10010,0b01101],
    'R':  [0b11110,0b10001,0b10001,0b11110,0b10100,0b10010,0b10001],
    'S':  [0b01110,0b10001,0b10000,0b01110,0b00001,0b10001,0b01110],
    'T':  [0b11111,0b00100,0b00100,0b00100,0b00100,0b00100,0b00100],
    'U':  [0b10001,0b10001,0b10001,0b10001,0b10001,0b10001,0b01110],
    'V':  [0b10001,0b10001,0b10001,0b10001,0b10001,0b01010,0b00100],
    'W':  [0b10001,0b10001,0b10001,0b10101,0b10101,0b11011,0b10001],
    'X':  [0b10001,0b01010,0b00100,0b00100,0b00100,0b01010,0b10001],
    'Y':  [0b10001,0b10001,0b01010,0b00100,0b00100,0b00100,0b00100],
    'Z':  [0b11111,0b00001,0b00010,0b00100,0b01000,0b10000,0b11111],
    'a':  [0,0,0b01110,0b00001,0b01111,0b10001,0b01111],
    'b':  [0b10000,0b10000,0b11110,0b10001,0b10001,0b10001,0b11110],
    'c':  [0,0,0b01110,0b10001,0b10000,0b10001,0b01110],
    'd':  [0b00001,0b00001,0b01111,0b10001,0b10001,0b10001,0b01111],
    'e':  [0,0,0b01110,0b10001,0b11111,0b10000,0b01110],
    'f':  [0b00110,0b01001,0b01000,0b11110,0b01000,0b01000,0b01000],
    'g':  [0,0,0b01111,0b10001,0b01111,0b00001,0b01110],
    'h':  [0b10000,0b10000,0b11110,0b10001,0b10001,0b10001,0b10001],
    'i':  [0b00100,0,0b01100,0b00100,0b00100,0b00100,0b01110],
    'j':  [0b00010,0,0b00110,0b00010,0b00010,0b10010,0b01100],
    'k':  [0b10000,0b10000,0b10010,0b10100,0b11000,0b10100,0b10010],
    'l':  [0b01100,0b00100,0b00100,0b00100,0b00100,0b00100,0b01110],
    'm':  [0,0,0b11010,0b10101,0b10101,0b10101,0b10101],
    'n':  [0,0,0b11110,0b10001,0b10001,0b10001,0b10001],
    'o':  [0,0,0b01110,0b10001,0b10001,0b10001,0b01110],
    'p':  [0,0,0b11110,0b10001,0b11110,0b10000,0b10000],
    'q':  [0,0,0b01111,0b10001,0b01111,0b00001,0b00001],
    'r':  [0,0,0b01110,0b10001,0b10000,0b10000,0b10000],
    's':  [0,0,0b01111,0b10000,0b01110,0b00001,0b11110],
    't':  [0b01000,0b01000,0b11110,0b01000,0b01000,0b01001,0b00110],
    'u':  [0,0,0b10001,0b10001,0b10001,0b10011,0b01101],
    'v':  [0,0,0b10001,0b10001,0b01010,0b01010,0b00100],
    'w':  [0,0,0b10001,0b10101,0b10101,0b11011,0b10001],
    'x':  [0,0,0b10001,0b01010,0b00100,0b01010,0b10001],
    'y':  [0,0,0b10001,0b10001,0b01111,0b00001,0b01110],
    'z':  [0,0,0b11111,0b00010,0b00100,0b01000,0b11111],
    '0':  [0b01110,0b10001,0b10011,0b10101,0b11001,0b10001,0b01110],
    '1':  [0b00100,0b01100,0b00100,0b00100,0b00100,0b00100,0b01110],
    '2':  [0b01110,0b10001,0b00001,0b00110,0b01000,0b10000,0b11111],
    '3':  [0b11111,0b00010,0b00100,0b00110,0b00001,0b10001,0b01110],
    '4':  [0b00010,0b00110,0b01010,0b10010,0b11111,0b00010,0b00010],
    '5':  [0b11111,0b10000,0b11110,0b00001,0b00001,0b10001,0b01110],
    '6':  [0b00110,0b01000,0b10000,0b11110,0b10001,0b10001,0b01110],
    '7':  [0b11111,0b00001,0b00010,0b00100,0b01000,0b01000,0b01000],
    '8':  [0b01110,0b10001,0b10001,0b01110,0b10001,0b10001,0b01110],
    '9':  [0b01110,0b10001,0b10001,0b01111,0b00001,0b00010,0b01100],
    '%':  [0b11000,0b11001,0b00010,0b00100,0b01000,0b10011,0b00011],
    '-':  [0,0,0,0b11111,0,0,0],
    '/':  [0b00001,0b00010,0b00100,0b01000,0b10000,0,0],
    '.':  [0,0,0,0,0,0b01100,0b01100],
    ':':  [0,0b01100,0b01100,0,0b01100,0b01100,0],
    '!':  [0b00100,0b00100,0b00100,0b00100,0b00100,0,0b00100],
    ',':  [0,0,0,0,0b01100,0b01100,0b01000],
    '\'': [0b00100,0b00100,0b00100,0,0,0,0],
    '?':  [0b01110,0b10001,0b00001,0b00110,0b00100,0,0b00100],
    '(':  [0b00010,0b00100,0b01000,0b01000,0b01000,0b00100,0b00010],
    ')':  [0b01000,0b00100,0b00010,0b00010,0b00010,0b00100,0b01000],
    '+':  [0,0b00100,0b00100,0b11111,0b00100,0b00100,0],
    '_':  [0,0,0,0,0,0,0b11111],
  };

  drawText(text: string, x: number, y: number, r: number, g: number, b: number, scale = 1) {
    let cx = x;
    for (const ch of text) {
      const glyph = Canvas.GLYPHS[ch] || Canvas.GLYPHS[' '];
      for (let row = 0; row < 7; row++) {
        const bits = glyph[row];
        for (let col = 0; col < 5; col++) {
          if (bits & (1 << (4 - col))) {
            for (let sy = 0; sy < scale; sy++)
              for (let sx = 0; sx < scale; sx++)
                this.setPixel(cx + col * scale + sx, y + row * scale + sy, r, g, b);
          }
        }
      }
      cx += 6 * scale;
    }
  }

  textWidth(text: string, scale = 1): number {
    return text.length * 6 * scale;
  }

  drawWrappedText(
    text: string, x: number, y: number, maxW: number,
    r: number, g: number, b: number, scale = 1, maxLines = 3
  ): number {
    const charW = 6 * scale;
    const lineH = (7 + 3) * scale;
    const charsPerLine = Math.floor(maxW / charW);
    const words = text.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      if (lines.length >= maxLines) break;
      const candidate = cur ? cur + ' ' + w : w;
      if (candidate.length <= charsPerLine) {
        cur = candidate;
      } else {
        if (cur) lines.push(cur);
        cur = w.slice(0, charsPerLine);
      }
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    for (const line of lines) {
      this.drawText(line, x, y, r, g, b, scale);
      y += lineH;
    }
    return y;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function leanLabel(leftPct: number, rightPct: number): { text: string; r: number; g: number; b: number } {
  const diff = Math.abs(leftPct - rightPct);
  if (diff < 20) return { text: 'MOSTLY BALANCED', r: 0x4C, g: 0xAF, b: 0x50 };
  if (diff < 40) return { text: 'LIGHTLY ONE-SIDED', r: 0xFF, g: 0xA7, b: 0x26 };
  if (diff < 60) return { text: 'MODERATELY BIASED', r: 0xFF, g: 0xA7, b: 0x26 };
  if (diff < 80) return { text: 'HEAVILY ONE-SIDED', r: 0xEF, g: 0x53, b: 0x50 };
  return { text: 'EXTREMELY BIASED', r: 0xEF, g: 0x53, b: 0x50 };
}

function deriveBiasPercentages(job: Record<string, unknown>): { leftPct: number; centerPct: number; rightPct: number } {
  const l = job.bias_left_pct as number | undefined;
  const r2 = job.bias_right_pct as number | undefined;
  const c = job.bias_center_pct as number | undefined;
  if (l != null && r2 != null) {
    return { leftPct: l, centerPct: c ?? (100 - l - r2), rightPct: r2 };
  }
  const bs = (job.biasScore as number) ?? 0;
  let lp: number, rp: number;
  if (bs < -5) {
    lp = Math.round(30 + Math.abs(bs) * 0.45);
    rp = Math.max(5, Math.round(20 - Math.abs(bs) * 0.15));
  } else if (bs > 5) {
    rp = Math.round(30 + bs * 0.45);
    lp = Math.max(5, Math.round(20 - bs * 0.15));
  } else {
    lp = 20; rp = 20;
  }
  return { leftPct: lp, centerPct: Math.max(5, 100 - lp - rp), rightPct: rp };
}

// ── Card renderers ────────────────────────────────────────────────────────────

async function genericCard(): Promise<Uint8Array> {
  const W = 1200, H = 630;
  const cv = new Canvas(W, H);
  cv.fillRect(0, 0, W, H, 0x0C, 0x1A, 0x24);
  for (let x = 0; x < W; x += 60) cv.fillRect(x, 0, 1, H, 0xFF, 0xFF, 0xFF, 10);
  for (let y = 0; y < H; y += 60) cv.fillRect(0, y, W, 1, 0xFF, 0xFF, 0xFF, 10);
  const wm = 'PODLENS'; const wmS = 8;
  cv.drawText(wm, Math.floor((W - cv.textWidth(wm, wmS)) / 2), 160, 0xFF, 0xFF, 0xFF, wmS);
  const tag = 'A force of clarity in the age of noise'; const tagS = 2;
  cv.drawText(tag, Math.floor((W - cv.textWidth(tag, tagS)) / 2), 280, 0x99, 0xBB, 0xCC, tagS);
  cv.fillRect(80, 380, W - 160, 1, 0xFF, 0xFF, 0xFF, 30);
  const url = 'podlens.app';
  cv.drawText(url, Math.floor((W - cv.textWidth(url, 2)) / 2), 450, 0x55, 0x88, 0x99, 2);
  return buildPng(W, H, cv.buf);
}

async function analysisCard(job: Record<string, unknown>): Promise<Uint8Array> {
  const W = 1200, H = 630;
  const cv = new Canvas(W, H);
  const PAD = 72;

  cv.fillRect(0, 0, W, H, 0x0C, 0x1A, 0x24);
  for (let x = 0; x < W; x += 60) cv.fillRect(x, 0, 1, H, 0xFF, 0xFF, 0xFF, 8);
  for (let y = 0; y < H; y += 60) cv.fillRect(0, y, W, 1, 0xFF, 0xFF, 0xFF, 8);
  cv.fillRect(0, 0, W, 4, 0x37, 0x8A, 0xDD);

  const textX = PAD;
  const textW = 720;

  // Header
  cv.drawText('PODLENS', textX, 28, 0xFF, 0xFF, 0xFF, 3);
  cv.drawText('BIAS ANALYSIS', textX + cv.textWidth('PODLENS', 3) + 18, 32, 0x37, 0x8A, 0xDD, 2);

  // Show name
  const showName = String(job.show_name || job.showName || 'Podcast').toUpperCase().slice(0, 36);
  cv.drawText(showName, textX, 100, 0x99, 0xCC, 0xFF, 2);

  // Episode title
  const episodeTitle = String(job.episode_title || job.episodeTitle || 'Episode Analysis');
  const afterTitle = cv.drawWrappedText(episodeTitle, textX, 132, textW, 0xFF, 0xFF, 0xFF, 4, 2);

  // Divider
  cv.fillRect(textX, afterTitle + 12, textW, 1, 0xFF, 0xFF, 0xFF, 30);

  // Bias bar
  const barY = afterTitle + 32;
  const barH = 18;
  const { leftPct, centerPct, rightPct } = deriveBiasPercentages(job);
  cv.drawBiasBar(textX, barY, textW, barH, leftPct, centerPct, rightPct);

  const lblY = barY + barH + 12;
  const lblS = 2;
  cv.drawText(leftPct + '% left', textX, lblY, 0xE2, 0x4B, 0x4A, lblS);
  const cLabel = centerPct + '% center';
  cv.drawText(cLabel, textX + Math.floor((textW - cv.textWidth(cLabel, lblS)) / 2), lblY, 0xCC, 0xCC, 0xCC, lblS);
  const rLabel = rightPct + '% right';
  cv.drawText(rLabel, textX + textW - cv.textWidth(rLabel, lblS), lblY, 0x37, 0x8A, 0xDD, lblS);

  const lean = leanLabel(leftPct, rightPct);
  cv.drawText(lean.text, textX, lblY + 28, lean.r, lean.g, lean.b, 2);

  // Right panel: trust score
  const panelX = W - PAD - 280;
  const panelW = 280;
  const panelH = 340;
  const panelY = 100;
  cv.fillRoundRect(panelX, panelY, panelW, panelH, 12, 0x12, 0x2A, 0x38, 220);

  const trustScore = (job.host_trust_score as number | undefined) ?? (job.trustScore as number | undefined);
  if (trustScore != null) {
    const score = Math.round(trustScore);
    const scoreStr = String(score);
    const scoreS = 8;
    cv.drawText(scoreStr, panelX + Math.floor((panelW - cv.textWidth(scoreStr, scoreS)) / 2), panelY + 32, 0xFF, 0xFF, 0xFF, scoreS);
    const outOf = '/100';
    cv.drawText(outOf, panelX + Math.floor((panelW - cv.textWidth(outOf, 2)) / 2), panelY + 106, 0x66, 0x99, 0xAA, 2);
    const trustLabel = 'TRUST SCORE';
    cv.drawText(trustLabel, panelX + Math.floor((panelW - cv.textWidth(trustLabel, 2)) / 2), panelY + 132, 0x99, 0xBB, 0xCC, 2);
    const tBarW = panelW - 40;
    const tBarX = panelX + 20;
    const tBarY = panelY + 166;
    cv.fillRect(tBarX, tBarY, tBarW, 8, 0x22, 0x44, 0x55);
    const filled = Math.round(tBarW * score / 100);
    const tr = score > 70 ? 0x4C : score > 40 ? 0xFF : 0xEF;
    const tg = score > 70 ? 0xAF : score > 40 ? 0xA7 : 0x53;
    const tb = score > 70 ? 0x50 : score > 40 ? 0x26 : 0x50;
    cv.fillRect(tBarX, tBarY, filled, 8, tr, tg, tb);
  }

  const hc = job.host_count as number | undefined;
  if (hc != null) {
    const hostStr = hc === 1 ? '1 HOST' : hc + ' HOSTS';
    cv.drawText(hostStr, panelX + Math.floor((panelW - cv.textWidth(hostStr, 2)) / 2), panelY + 210, 0x99, 0xBB, 0xCC, 2);
  }
  if (job.has_guest) {
    const gStr = 'GUEST FEATURED';
    cv.drawText(gStr, panelX + Math.floor((panelW - cv.textWidth(gStr, 2)) / 2), panelY + 232, 0xFF, 0xCC, 0x44, 2);
  }
  const fcArr = job.flags as unknown[] | undefined;
  const fc = fcArr != null ? fcArr.length : (job.flagsCount as number | undefined);
  if (fc != null && fc > 0) {
    const fStr = fc + (fc === 1 ? ' FLAG' : ' FLAGS');
    cv.drawText(fStr, panelX + Math.floor((panelW - cv.textWidth(fStr, 2)) / 2), panelY + 256, 0xFF, 0x77, 0x44, 2);
  }

  // Footer
  cv.fillRect(PAD, H - 72, W - PAD * 2, 1, 0xFF, 0xFF, 0xFF, 20);
  cv.drawText('podlens.app', PAD, H - 48, 0x55, 0x88, 0x99, 2);
  const date = new Date().toISOString().slice(0, 10);
  cv.drawText(date, W - PAD - cv.textWidth(date, 2), H - 48, 0x55, 0x88, 0x99, 2);

  return buildPng(W, H, cv.buf);
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: Request, _context: Context) {
  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");

  const PNG_HEADERS = {
    "Content-Type": "image/png",
    "Cache-Control": "public, max-age=86400",
  };

  if (!jobId) {
    const png = await genericCard();
    return new Response(png.buffer as ArrayBuffer, { status: 200, headers: PNG_HEADERS });
  }

  try {
    const store = getStore("podlens-jobs");
    const job = await store.get(jobId, { type: "json" }) as Record<string, unknown> | null;

    if (!job || job.status !== "complete") {
      const png = await genericCard();
      return new Response(png.buffer as ArrayBuffer, { status: 200, headers: PNG_HEADERS });
    }

    const png = await analysisCard(job);
    return new Response(png.buffer as ArrayBuffer, { status: 200, headers: PNG_HEADERS });
  } catch (err) {
    console.error("[og-image] Error:", err);
    const png = await genericCard();
    return new Response(png.buffer as ArrayBuffer, { status: 200, headers: PNG_HEADERS });
  }
}

export const config = {
  path: "/api/og-image",
};
