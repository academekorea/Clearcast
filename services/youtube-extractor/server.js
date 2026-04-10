const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { execFile, exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');

const execFileAsync = util.promisify(execFile);

process.on('uncaughtException', (err) => { console.error('Uncaught exception:', err); });
process.on('unhandledRejection', (err) => { console.error('Unhandled rejection:', err); });

const app = express();
app.use(cors());
app.use(express.json());
app.use(rateLimit({ windowMs: 60000, max: 20 }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[startup] YouTube extractor running on port ${PORT}`);
});

// ── Cookies ───────────────────────────────────────────────────────────────────
if (process.env.YOUTUBE_COOKIES) {
  try {
    fs.writeFileSync('/app/cookies.txt', process.env.YOUTUBE_COOKIES);
    console.log('[startup] YouTube cookies written');
  } catch(e) { console.error('[startup] cookie write failed:', e.message); }
}
const cookieArgs = fs.existsSync('/app/cookies.txt') ? ['--cookies', '/app/cookies.txt'] : [];

exec('yt-dlp --version', (err, stdout) => {
  if (err) console.error('[startup] yt-dlp not found:', err.message);
  else console.log('[startup] yt-dlp version:', stdout.trim());
});

if (!process.env.YOUTUBE_SERVICE_SECRET) {
  console.warn('[startup] Warning: YOUTUBE_SERVICE_SECRET not set');
}

// ── Client configs ────────────────────────────────────────────────────────────
// Each client has different bot-detection bypass capability
const CLIENT_CONFIGS = {
  ios:     { extractor: 'ios',            ua: 'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)' },
  android: { extractor: 'android',        ua: 'com.google.android.youtube/19.30.37 (Linux; U; Android 14)' },
  web:     { extractor: 'web',            ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
  mweb:    { extractor: 'mweb',           ua: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36' },
  tv:      { extractor: 'tv_embedded',    ua: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.5) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.5 TV Safari/538.1' },
};

function getClientArgs(clientName) {
  const cfg = CLIENT_CONFIGS[clientName] || CLIENT_CONFIGS.android;
  return {
    extractorArgs: `youtube:player_client=${cfg.extractor}`,
    userAgent: cfg.ua,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function extractVideoId(url) {
  const patterns = [
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /m\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) { const m = url.match(p); if (m) return m[1]; }
  return null;
}

function parseVTT(vttContent) {
  const seen = new Set();
  const lines = [];
  for (const line of vttContent.split('\n')) {
    if (line.includes('-->') || line.startsWith('WEBVTT') || /^\d+$/.test(line.trim()) || !line.trim()) continue;
    const clean = line.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").trim();
    if (clean && !seen.has(clean)) { seen.add(clean); lines.push(clean); }
  }
  return lines.join(' ');
}

function cleanupFiles(videoId, tmpDir) {
  const exts = ['.vtt', '.en.vtt', '.mp3', '.m4a', '.webm', '.mp4', '.part'];
  for (const ext of exts) {
    const fp = path.join(tmpDir, videoId + ext);
    try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch(e) {}
  }
  // Also clean any yt-dlp temp files matching the video ID
  try {
    fs.readdirSync(tmpDir).filter(f => f.startsWith(videoId)).forEach(f => {
      try { fs.unlinkSync(path.join(tmpDir, f)); } catch(e) {}
    });
  } catch(e) {}
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ ok: true, port: PORT, ts: Date.now(), service: 'podlens-youtube-extractor' });
});

app.post('/extract', async (req, res) => {
  const secret = process.env.YOUTUBE_SERVICE_SECRET;
  if (!req.headers.authorization || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const { url, ytClient } = req.body;
  if (!url || !extractVideoId(url)) {
    return res.status(400).json({ success: false, error: 'Not a valid YouTube URL' });
  }

  const videoId = extractVideoId(url);
  const tmpDir = '/tmp';
  const clientName = ytClient || 'android';
  const { extractorArgs, userAgent } = getClientArgs(clientName);

  console.log(`[extract] videoId=${videoId} client=${clientName}`);

  // ── Step 1: Metadata (best-effort, never abort on failure) ────────────────
  let metadata = { videoId };
  try {
    const { stdout } = await execFileAsync('yt-dlp', [
      '--dump-json', '--no-warnings', '--skip-download',
      '--extractor-args', extractorArgs,
      '--user-agent', userAgent,
      '--no-check-certificates',
      ...cookieArgs, url
    ], { timeout: 30000 });
    const info = JSON.parse(stdout);
    metadata = {
      videoId,
      title: info.title || '',
      channelTitle: info.uploader || info.channel || '',
      duration: info.duration,
      thumbnail: info.thumbnail || '',
      published: info.upload_date || '',
    };
    console.log(`[extract] metadata ok: "${metadata.title}"`);
  } catch(e) {
    console.warn(`[extract] metadata failed (${clientName}):`, e.message?.slice(0, 150));
  }

  // ── Step 2: Try captions (fastest — no audio download needed) ─────────────
  try {
    // Clean any stale caption files first
    cleanupFiles(videoId, tmpDir);

    await execFileAsync('yt-dlp', [
      '--write-sub', '--write-auto-sub',
      '--sub-lang', 'en',
      '--sub-format', 'vtt',
      '--skip-download', '--no-warnings',
      '--extractor-args', extractorArgs,
      '--user-agent', userAgent,
      '--no-check-certificates',
      ...cookieArgs,
      '-o', path.join(tmpDir, '%(id)s.%(ext)s'),
      url
    ], { timeout: 60000 });

    // Check multiple possible output paths
    const captionPaths = [
      path.join(tmpDir, `${videoId}.en.vtt`),
      path.join(tmpDir, `${videoId}.en-US.vtt`),
      path.join(tmpDir, `${videoId}.vtt`),
    ];
    for (const cp of captionPaths) {
      if (fs.existsSync(cp)) {
        const transcript = parseVTT(fs.readFileSync(cp, 'utf8'));
        cleanupFiles(videoId, tmpDir);
        if (transcript.split(' ').length > 50) {
          console.log(`[extract] captions ok (${clientName}): ${transcript.split(' ').length} words`);
          return res.json({ success: true, method: `captions-${clientName}`, transcript, metadata });
        }
      }
    }
    console.log(`[extract] no usable captions from ${clientName}, trying audio`);
  } catch(captionErr) {
    console.warn(`[extract] captions failed (${clientName}):`, captionErr.message?.slice(0, 150));
  }

  // ── Step 3: Audio extraction → return raw audio for AssemblyAI ───────────
  try {
    cleanupFiles(videoId, tmpDir);
    const audioOutTemplate = path.join(tmpDir, '%(id)s.%(ext)s');

    await execFileAsync('yt-dlp', [
      '-x', '--audio-format', 'mp3', '--audio-quality', '5',
      '--no-warnings',
      '--extractor-args', extractorArgs,
      '--user-agent', userAgent,
      '--no-check-certificates',
      '--max-filesize', '150m',
      ...cookieArgs,
      '-o', audioOutTemplate,
      url
    ], { timeout: 180000 });

    const audioPath = path.join(tmpDir, `${videoId}.mp3`);
    if (fs.existsSync(audioPath)) {
      const stat = fs.statSync(audioPath);
      console.log(`[extract] audio ok (${clientName}): ${(stat.size/1024/1024).toFixed(1)}MB`);
      const audioData = fs.readFileSync(audioPath).toString('base64');
      cleanupFiles(videoId, tmpDir);
      return res.json({ success: true, method: `audio-${clientName}`, audioData, metadata });
    }
  } catch(audioErr) {
    const msg = audioErr.message || '';
    console.error(`[extract] audio failed (${clientName}):`, msg.slice(0, 200));

    // Return specific error codes the caller can act on
    if (msg.includes('Private video')) {
      return res.json({ success: false, error: 'This video is private', code: 'PRIVATE_VIDEO' });
    }
    if (msg.includes('not available') || msg.includes('unavailable')) {
      return res.json({ success: false, error: 'Video unavailable in this region', code: 'UNAVAILABLE' });
    }
    if (msg.includes('Sign in') || msg.includes('age-restricted')) {
      return res.json({ success: false, error: 'Age-restricted — connect your Google account to analyze', code: 'AGE_RESTRICTED', suggestion: 'connect_google' });
    }
    if (msg.includes('bot') || msg.includes('blocked') || msg.includes('403')) {
      return res.json({ success: false, error: `Bot detection on ${clientName} client`, code: 'BOT_DETECTED', suggestion: 'try_next_client' });
    }
  }

  cleanupFiles(videoId, tmpDir);
  return res.json({
    success: false,
    error: `Extraction failed with ${clientName} client`,
    code: 'EXTRACTION_FAILED',
    suggestion: 'try_next_client',
  });
});
