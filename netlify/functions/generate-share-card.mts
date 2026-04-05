import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { sbInsert, trackEvent } from "./lib/supabase.js";
import { createHash } from "crypto";

// Generates a 1200x630 PNG share card for an analysis
// Uses pure Node.js (no external image libraries)
// Returns PNG binary data

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

  // Scanlines: filter byte (0) + 4 bytes per pixel (RGBA)
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter None
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
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB — wait, we're RGBA
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const idat = makeChunk('IDAT', compressed);
  const png = new Uint8Array([...sig, ...makeChunk('IHDR', ihdr), ...idat, ...makeChunk('IEND', new Uint8Array(0))]);
  return png;
}

// Simple canvas-like pixel buffer
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

  // Draw horizontal bias bar
  drawBiasBar(x: number, y: number, w: number, h: number, lPct: number, cPct: number, rPct: number) {
    const lW = Math.round(w * lPct / 100);
    const cW = Math.round(w * cPct / 100);
    const rW = w - lW - cW;
    this.fillRect(x, y, lW, h, 0xE2, 0x4B, 0x4A);
    this.fillRect(x+lW, y, cW, h, 0xD1, 0xCF, 0xC9);
    this.fillRect(x+lW+cW, y, rW, h, 0x37, 0x8A, 0xDD);
  }

  // 5x7 bitmap font — basic ASCII 32-90
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
    'a':  [0,0b01110,0b00001,0b01111,0b10001,0b10011,0b01101],
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
    '←':  [0,0b00100,0b01000,0b11111,0b01000,0b00100,0],
    '→':  [0,0b00100,0b00010,0b11111,0b00010,0b00100,0],
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
      cx += (5 + 1) * scale;
    }
  }

  textWidth(text: string, scale = 1): number {
    return text.length * (5 + 1) * scale;
  }
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const analysisId = url.searchParams.get('id') || '';
  const shareId = url.searchParams.get('shareId') || analysisId;

  if (!analysisId && !shareId) {
    return new Response('Missing id', { status: 400 });
  }

  // Check Blobs cache
  const cacheKey = `share-card-${analysisId || shareId}`;
  try {
    const blobStore = getStore('podlens-cache');
    const cached = await blobStore.get(cacheKey, { type: 'arrayBuffer' });
    if (cached) {
      return new Response(cached, {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' },
      });
    }
  } catch { /* cache miss */ }

  // Get analysis data from query params (for fast generation without a DB lookup)
  const showName = url.searchParams.get('show') || 'Podcast';
  const episodeTitle = url.searchParams.get('title') || 'Episode Analysis';
  const biasLabel = url.searchParams.get('label') || 'Mostly balanced';
  const lPct = parseInt(url.searchParams.get('l') || '30', 10);
  const cPct = parseInt(url.searchParams.get('c') || '40', 10);
  const rPct = parseInt(url.searchParams.get('r') || '30', 10);

  // Generate 1200x630 card
  const W = 1200, H = 630;
  const canvas = new Canvas(W, H);

  // Navy background
  canvas.fillRect(0, 0, W, H, 0x0F, 0x20, 0x27);

  // Subtle grid pattern
  for (let x = 0; x < W; x += 60) canvas.fillRect(x, 0, 1, H, 0xFF, 0xFF, 0xFF, 12);
  for (let y = 0; y < H; y += 60) canvas.fillRect(0, y, W, 1, 0xFF, 0xFF, 0xFF, 12);

  // PODLENS wordmark — large centered
  const wmText = 'PODLENS';
  const wmScale = 6;
  const wmW = canvas.textWidth(wmText, wmScale);
  canvas.drawText(wmText, (W - wmW) / 2, 80, 0xFF, 0xFF, 0xFF, wmScale);

  // Tagline
  const tagText = 'Know what you\'re actually listening to';
  const tagScale = 2;
  const tagW = canvas.textWidth(tagText, tagScale);
  canvas.drawText(tagText, (W - tagW) / 2, 200, 0xFF, 0xFF, 0xFF, tagScale);
  // Lower opacity by drawing over with bg color at partial alpha — simulate by mixing
  // (Simple approximation: draw tagline at 50% brightness)
  canvas.drawText(tagText, (W - tagW) / 2, 200, 0x07, 0x10, 0x13, tagScale); // blend trick: draw again dark

  // Divider line
  canvas.fillRect(80, 260, W - 160, 1, 0xFF, 0xFF, 0xFF, 40);

  // Show name
  const showScale = 2;
  const showTrunc = showName.slice(0, 30).toUpperCase();
  canvas.drawText(showTrunc, 80, 290, 0xFF, 0xFF, 0xFF, showScale);

  // Episode title (max 2 lines of 40 chars)
  const epLine1 = episodeTitle.slice(0, 45);
  const epLine2 = episodeTitle.length > 45 ? episodeTitle.slice(45, 85) + (episodeTitle.length > 85 ? '...' : '') : '';
  canvas.drawText(epLine1, 80, 330, 0xFF, 0xFF, 0xFF, 3);
  if (epLine2) canvas.drawText(epLine2, 80, 360, 0xFF, 0xFF, 0xFF, 3);

  // Divider
  canvas.fillRect(80, 415, W - 160, 1, 0xFF, 0xFF, 0xFF, 40);

  // Bias bar — large
  canvas.drawBiasBar(80, 440, W - 160, 20, lPct, cPct, rPct);

  // Bias label
  const lblScale = 2;
  canvas.drawText(biasLabel.toUpperCase(), 80, 480, 0xFF, 0xFF, 0xFF, lblScale);

  // Percentages
  const pctText = lPct + '% left  ' + cPct + '% center  ' + rPct + '% right';
  canvas.drawText(pctText, 80, 510, 0xFF, 0xFF, 0xFF, lblScale);

  // podlens.app bottom right
  const urlText = 'podlens.app';
  const urlW = canvas.textWidth(urlText, 2);
  canvas.drawText(urlText, W - urlW - 80, 560, 0x7F, 0x9F, 0x9F, 2);

  const png = await buildPng(W, H, canvas.buf);

  // Cache in Blobs (fire-and-forget)
  try {
    const blobStore = getStore('podlens-cache');
    await blobStore.set(cacheKey, png.buffer as ArrayBuffer, { metadata: { contentType: 'image/png' } });
  } catch { /* non-critical */ }

  return new Response(png.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  });
};

export const config: Config = { path: '/api/share-card' };
