const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { execFile, exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');

const execFileAsync = util.promisify(execFile);

// ── Global error handlers — log crashes, never let Railway SIGTERM silently ──
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

const app = express();
app.use(cors());
app.use(express.json());
app.use(rateLimit({ windowMs: 60000, max: 10 }));

// ── Bind port immediately so Railway health check responds at once ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('YouTube extractor running on port ' + PORT);
});

// ── Non-blocking startup checks (after port is bound) ──
exec('yt-dlp --version', (err, stdout) => {
  if (err) console.error('yt-dlp not found:', err.message);
  else console.log('yt-dlp version:', stdout.trim());
});

if (!process.env.YOUTUBE_SERVICE_SECRET) {
  console.warn('Warning: YOUTUBE_SERVICE_SECRET is not set — /extract will reject all requests');
}

// ── Helpers ──
function extractVideoId(url) {
  const patterns = [
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtu\.be\/([^?]+)/,
    /youtube\.com\/shorts\/([^?]+)/,
    /m\.youtube\.com\/watch\?v=([^&]+)/
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function isYouTubeUrl(url) {
  return extractVideoId(url) !== null;
}

function parseVTT(vttContent) {
  const lines = vttContent.split('\n');
  const textLines = [];
  for (const line of lines) {
    if (line.includes('-->') ||
        line.startsWith('WEBVTT') ||
        line.trim() === '' ||
        /^\d+$/.test(line.trim())) continue;
    const clean = line
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
    if (clean && !textLines.includes(clean)) {
      textLines.push(clean);
    }
  }
  return textLines.join(' ');
}

// ── Routes ──
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: Date.now(), service: 'podlens-youtube-extractor' });
});

app.post('/extract', async (req, res) => {
  const authHeader = req.headers.authorization;
  const secret = process.env.YOUTUBE_SERVICE_SECRET;
  if (!authHeader || authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const { url } = req.body;
  if (!url || !isYouTubeUrl(url)) {
    return res.status(400).json({ success: false, error: 'Not a valid YouTube URL' });
  }

  const videoId = extractVideoId(url);
  const tmpDir = '/tmp';

  try {
    // Step 1: Get metadata
    const { stdout: metaStdout } = await execFileAsync('yt-dlp', [
      '--dump-json',
      '--no-warnings',
      '--skip-download',
      url
    ]);
    const info = JSON.parse(metaStdout);

    const metadata = {
      title: info.title,
      channel: info.uploader || info.channel,
      duration: info.duration,
      thumbnail: info.thumbnail,
      published: info.upload_date,
      videoId,
    };

    // Step 2: Try captions first
    try {
      const captionPath = path.join(tmpDir, `${videoId}.en.vtt`);

      await execFileAsync('yt-dlp', [
        '--write-sub',
        '--write-auto-sub',
        '--sub-lang', 'en',
        '--sub-format', 'vtt',
        '--skip-download',
        '--no-warnings',
        '-o', path.join(tmpDir, '%(id)s.%(ext)s'),
        url
      ]);

      if (fs.existsSync(captionPath)) {
        const vttContent = fs.readFileSync(captionPath, 'utf8');
        const transcript = parseVTT(vttContent);
        fs.unlinkSync(captionPath);
        return res.json({ success: true, method: 'captions', transcript, metadata });
      }
    } catch (captionErr) {
      // No captions — fall through to audio extraction
    }

    // Step 3: Fall back to audio extraction
    const audioPath = path.join(tmpDir, `${videoId}.mp3`);

    await execFileAsync('yt-dlp', [
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--no-warnings',
      '-o', path.join(tmpDir, '%(id)s.%(ext)s'),
      url
    ]);

    if (fs.existsSync(audioPath)) {
      const audioData = fs.readFileSync(audioPath).toString('base64');
      fs.unlinkSync(audioPath);
      return res.json({ success: true, method: 'audio', audioData, metadata });
    }

    return res.json({
      success: false,
      error: 'Could not extract captions or audio',
      code: 'EXTRACTION_FAILED',
    });

  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('Private video')) {
      return res.json({ success: false, error: 'This video is private', code: 'PRIVATE_VIDEO' });
    }
    if (msg.includes('unavailable')) {
      return res.json({ success: false, error: 'This video is unavailable', code: 'VIDEO_UNAVAILABLE' });
    }
    return res.json({
      success: false,
      error: 'Could not process this YouTube video',
      code: 'EXTRACTION_FAILED',
    });
  }
});
