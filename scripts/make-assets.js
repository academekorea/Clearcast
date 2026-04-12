// Pure Node.js PNG generator — no dependencies
// Generates favicon-16.png, favicon-32.png, favicon-180.png, og-image.png
import { writeFileSync } from 'fs';
import { deflateSync } from 'zlib';

// ─── PNG encoder ──────────────────────────────────────────────────────────────

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c;
}
function crc32(buf, seed = 0xffffffff) {
  let c = seed;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function u32be(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; }
function chunk(type, data) {
  const t = Buffer.from(type);
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(Buffer.concat([t, d])));
  return Buffer.concat([u32be(d.length), t, d, c]);
}
function makePNG(w, h, pixels /* Uint8Array: RGBA rows, w*h*4 */) {
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8]=8; ihdr[9]=6; // 8-bit RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter: None
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4, di = y * (1 + w * 4) + 1 + x * 4;
      raw[di] = pixels[si]; raw[di+1] = pixels[si+1];
      raw[di+2] = pixels[si+2]; raw[di+3] = pixels[si+3];
    }
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, {level:9})), chunk('IEND', Buffer.alloc(0))]);
}

// ─── Pixel helpers ────────────────────────────────────────────────────────────

function newImage(w, h, r=0, g=0, b=0, a=0) {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { px[i*4]=r; px[i*4+1]=g; px[i*4+2]=b; px[i*4+3]=a; }
  return px;
}
function setPixel(px, w, x, y, r, g, b, a=255) {
  if (x<0||y<0||x>=w||y>=Math.floor(px.length/(w*4))) return;
  const i=(y*w+x)*4; px[i]=r; px[i+1]=g; px[i+2]=b; px[i+3]=a;
}
function fillRect(px, pw, x, y, rw, rh, r, g, b, a=255) {
  for (let dy=0;dy<rh;dy++) for (let dx=0;dx<rw;dx++) setPixel(px,pw,x+dx,y+dy,r,g,b,a);
}
function roundRect(px, pw, ph, rx, ry, rw, rh, radius, r, g, b, a=255) {
  for (let dy=0;dy<rh;dy++) for (let dx=0;dx<rw;dx++) {
    const x=rx+dx, y=ry+dy;
    let inside = true;
    // Check corners
    if (dx < radius && dy < radius) {
      const cx=rx+radius, cy=ry+radius;
      inside = (x-cx)*(x-cx)+(y-cy)*(y-cy) <= radius*radius;
    } else if (dx >= rw-radius && dy < radius) {
      const cx=rx+rw-radius-1, cy=ry+radius;
      inside = (x-cx)*(x-cx)+(y-cy)*(y-cy) <= radius*radius;
    } else if (dx < radius && dy >= rh-radius) {
      const cx=rx+radius, cy=ry+rh-radius-1;
      inside = (x-cx)*(x-cx)+(y-cy)*(y-cy) <= radius*radius;
    } else if (dx >= rw-radius && dy >= rh-radius) {
      const cx=rx+rw-radius-1, cy=ry+rh-radius-1;
      inside = (x-cx)*(x-cx)+(y-cy)*(y-cy) <= radius*radius;
    }
    if (inside) setPixel(px,pw,x,y,r,g,b,a);
  }
}

// ─── Simple bitmap font (5×7 grid, each char is 35-bit mask) ─────────────────

const GLYPHS = {
  'P': [0b11110,0b10001,0b10001,0b11110,0b10000,0b10000,0b10000],
  'L': [0b10000,0b10000,0b10000,0b10000,0b10000,0b10000,0b11111],
  'O': [0b01110,0b10001,0b10001,0b10001,0b10001,0b10001,0b01110],
  'D': [0b11110,0b10001,0b10001,0b10001,0b10001,0b10001,0b11110],
  'E': [0b11111,0b10000,0b10000,0b11110,0b10000,0b10000,0b11111],
  'N': [0b10001,0b11001,0b10101,0b10011,0b10001,0b10001,0b10001],
  'S': [0b01111,0b10000,0b10000,0b01110,0b00001,0b00001,0b11110],
  'K': [0b10001,0b10010,0b10100,0b11000,0b10100,0b10010,0b10001],
  'W': [0b10001,0b10001,0b10001,0b10101,0b10101,0b11011,0b10001],
  'H': [0b10001,0b10001,0b10001,0b11111,0b10001,0b10001,0b10001],
  'A': [0b01110,0b10001,0b10001,0b11111,0b10001,0b10001,0b10001],
  'T': [0b11111,0b00100,0b00100,0b00100,0b00100,0b00100,0b00100],
  'Y': [0b10001,0b10001,0b01010,0b00100,0b00100,0b00100,0b00100],
  'U': [0b10001,0b10001,0b10001,0b10001,0b10001,0b10001,0b01110],
  'R': [0b11110,0b10001,0b10001,0b11110,0b10100,0b10010,0b10001],
  'I': [0b11111,0b00100,0b00100,0b00100,0b00100,0b00100,0b11111],
  'G': [0b01110,0b10001,0b10000,0b10111,0b10001,0b10001,0b01110],
  ' ': [0b00000,0b00000,0b00000,0b00000,0b00000,0b00000,0b00000],
  '.': [0b00000,0b00000,0b00000,0b00000,0b00000,0b00000,0b00100],
};

function drawText(px, pw, text, ox, oy, scale, r, g, b, a=255) {
  let cx = ox;
  for (const ch of text.toUpperCase()) {
    const glyph = GLYPHS[ch] || GLYPHS[' '];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row] & (1 << (4 - col))) {
          fillRect(px, pw, cx + col*scale, oy + row*scale, scale, scale, r, g, b, a);
        }
      }
    }
    cx += (ch === ' ' ? 3 : 6) * scale;
  }
  return cx - ox; // total width
}

function textWidth(text, scale) {
  let w = 0;
  for (const ch of text.toUpperCase()) {
    w += (ch === ' ' ? 3 : 6) * scale;
  }
  return w - scale; // no trailing gap
}

// ─── Brand colors ─────────────────────────────────────────────────────────────

const NAVY    = [0x0f, 0x20, 0x27];
const WHITE   = [0xff, 0xff, 0xff];
const NAVY_MID= [0x1a, 0x3a, 0x4a];
const CREAM   = [0xfa, 0xf9, 0xf6];
const LEFT_C  = [0xe2, 0x4b, 0x4a];
const RIGHT_C = [0x37, 0x8a, 0xdd];

// ─── Favicon 32×32 ────────────────────────────────────────────────────────────

function makeFavicon(size) {
  const px = newImage(size, size, 0,0,0,0);
  const r = Math.round(size * 0.1875); // 6/32
  roundRect(px, size, size, 0, 0, size, size, r, ...NAVY);

  const scale = Math.max(1, Math.round(size / 32));
  // Draw "PL" centered
  const tw = textWidth('PL', scale);
  const ox = Math.round((size - tw) / 2) - scale;
  const oy = Math.round((size - 7*scale) / 2);
  drawText(px, size, 'PL', ox, oy, scale, ...WHITE);
  return px;
}

// ─── Apple touch icon 180×180 ─────────────────────────────────────────────────

function makeAppleIcon() {
  const size = 180;
  const px = newImage(size, size, ...NAVY);
  const r = 12;
  // Apple icon: fully filled (iOS clips to circle shape itself)
  // Fill all with navy first (already done)
  // Draw "PL" centered, scale 5
  const scale = 5;
  const tw = textWidth('PL', scale);
  const ox = Math.round((size - tw) / 2) - scale;
  const oy = Math.round((size - 7*scale) / 2);
  drawText(px, size, 'PL', ox, oy, scale, ...WHITE);
  return px;
}

// ─── OG image 1200×630 ────────────────────────────────────────────────────────

function makeOgImage() {
  const W = 1200, H = 630;
  const px = newImage(W, H, ...NAVY);

  // Subtle dot grid pattern in background
  for (let y = 30; y < H; y += 40) {
    for (let x = 30; x < W; x += 40) {
      // Small 2×2 dot
      for (let dy=0;dy<2;dy++) for (let dx=0;dx<2;dx++) {
        setPixel(px, W, x+dx, y+dy, 0x1a, 0x3a, 0x4a);
      }
    }
  }

  // Left accent bar (bias bar strip)
  fillRect(px, W, 0, H-8, Math.round(W*0.52), 8, ...LEFT_C);
  fillRect(px, W, Math.round(W*0.52), H-8, Math.round(W*0.23), 8, 0xd1,0xcf,0xc9);
  fillRect(px, W, Math.round(W*0.75), H-8, Math.round(W*0.25), 8, ...RIGHT_C);

  // Icon lockup: mini favicon square at center-left
  const iconSize = 72;
  const iconX = Math.round(W/2 - iconSize/2 - 200);
  const iconY = Math.round(H/2 - 90);
  roundRect(px, W, H, iconX, iconY, iconSize, iconSize, 8, ...WHITE, 200);

  // Divider line
  const divX = Math.round(W/2 - 110);
  fillRect(px, W, divX, iconY+4, 1, iconSize-8, 0xff,0xff,0xff, 80);

  // PODLENS wordmark — large
  const wmScale = 8;
  const pod = 'POD';
  const lens = 'LENS';
  const podW = textWidth(pod, wmScale);
  const lensW = textWidth(lens, wmScale);
  const totalW = podW + wmScale + lensW; // +gap
  const wmX = Math.round(W/2 - totalW/2);
  const wmY = Math.round(H/2 - 7*wmScale/2 - 40);

  // POD in weight 400 (same pixels, drawn at 70% opacity to simulate lighter weight)
  drawText(px, W, pod, wmX, wmY, wmScale, 0xff,0xff,0xff, 200);
  // LENS in weight 700 (full opacity)
  drawText(px, W, lens, wmX + podW + wmScale, wmY, wmScale, 0xff,0xff,0xff, 255);

  // Tagline below
  const tagScale = 2;
  const tagline = 'KNOW WHAT YOU ARE ACTUALLY LISTENING TO';
  const tagW = textWidth(tagline, tagScale);
  const tagX = Math.round(W/2 - tagW/2);
  const tagY = wmY + 7*wmScale + 20;
  drawText(px, W, tagline, tagX, tagY, tagScale, 0xff,0xff,0xff, 100);

  // podlens.app bottom right
  const urlScale = 2;
  const urlText = 'PODLENS.APP';
  const urlW = textWidth(urlText, urlScale);
  drawText(px, W, urlText, W - urlW - 48, H - 40, urlScale, 0xff,0xff,0xff, 60);

  return px;
}

// ─── Generate files ────────────────────────────────────────────────────────────

const outDir = '/Users/albertlee/Desktop/podlens';

writeFileSync(`${outDir}/favicon-16.png`,  makePNG(16,  16,  makeFavicon(16)));
writeFileSync(`${outDir}/favicon-32.png`,  makePNG(32,  32,  makeFavicon(32)));
writeFileSync(`${outDir}/favicon-180.png`, makePNG(180, 180, makeAppleIcon()));
writeFileSync(`${outDir}/og-image.png`,    makePNG(1200, 630, makeOgImage()));

console.log('✓ favicon-16.png');
console.log('✓ favicon-32.png');
console.log('✓ favicon-180.png');
console.log('✓ og-image.png  (1200×630)');
