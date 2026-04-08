const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const youtubedl = require('youtube-dl-exec');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const limiter = rateLimit({ windowMs: 60000, max: 10 });
app.use(limiter);

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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'podlens-youtube-extractor' });
});

app.post('/extract', async (req, res) => {
  const authHeader = req.headers.authorization;
  const secret = process.env.YOUTUBE_SERVICE_SECRET;
  if (!authHeader || authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({
      success: false, error: 'Unauthorized'
    });
  }

  const { url } = req.body;
  if (!url || !isYouTubeUrl(url)) {
    return res.status(400).json({
      success: false, error: 'Not a valid YouTube URL'
    });
  }

  const videoId = extractVideoId(url);
  const tmpDir = '/tmp';

  try {
    // Get metadata
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      skipDownload: true,
      noCallHome: true
    });

    const metadata = {
      title: info.title,
      channel: info.uploader || info.channel,
      duration: info.duration,
      thumbnail: info.thumbnail,
      published: info.upload_date,
      videoId
    };

    // Try captions first
    try {
      const captionPath = path.join(tmpDir, `${videoId}.en.vtt`);
      await youtubedl(url, {
        writeSub: true,
        writeAutoSub: true,
        subLang: 'en',
        subFormat: 'vtt',
        skipDownload: true,
        noWarnings: true,
        output: path.join(tmpDir, '%(id)s.%(ext)s')
      });

      if (fs.existsSync(captionPath)) {
        const vttContent = fs.readFileSync(captionPath, 'utf8');
        const transcript = parseVTT(vttContent);
        fs.unlinkSync(captionPath);
        return res.json({
          success: true,
          method: 'captions',
          transcript,
          metadata
        });
      }
    } catch (captionErr) {
      // No captions — fall through to audio
    }

    // Fall back to audio extraction
    const audioPath = path.join(tmpDir, `${videoId}.mp3`);
    await youtubedl(url, {
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: 0,
      noWarnings: true,
      output: path.join(tmpDir, '%(id)s.%(ext)s')
    });

    if (fs.existsSync(audioPath)) {
      const audioData = fs.readFileSync(audioPath).toString('base64');
      fs.unlinkSync(audioPath);
      return res.json({
        success: true,
        method: 'audio',
        audioData,
        metadata
      });
    }

    return res.json({
      success: false,
      error: 'Could not extract captions or audio',
      code: 'EXTRACTION_FAILED'
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
      code: 'EXTRACTION_FAILED'
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`YouTube extractor running on port ${PORT}`);
});
