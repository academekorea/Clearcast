import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

const OPENAI_KEY = () => Netlify.env.get("OPENAI_API_KEY") || "";
const ELEVENLABS_KEY = () => Netlify.env.get("ELEVENLABS_API_KEY") || "";
const ELEVENLABS_VOICE_EN = "pqHfZKP75CvOlQylNhV4"; // Bill — warm, clear, natural for narration
const ELEVENLABS_VOICE_KO = "ThT5KcBeYPX3keUQqHPh"; // Dorothy — multilingual

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { jobId, script, lang = "en", userId, voiceId: requestedVoiceId } = body;

  if (!jobId || !script) {
    return new Response(JSON.stringify({ error: "jobId and script required" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const store = getStore("podlens-audio-briefings");
  const effectiveVoiceId = requestedVoiceId || ELEVENLABS_VOICE_EN;
  const cacheKey = `briefing-v2-${jobId}-${lang}-${effectiveVoiceId.slice(0, 8)}`;

  // Check cache
  try {
    const cached = await store.get(cacheKey, { type: "arrayBuffer" });
    if (cached && cached.byteLength > 100) {
      return new Response(cached, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "public, max-age=2592000",
          "X-Cache": "HIT",
        }
      });
    }
  } catch {}

  // Trim script to ~500 words for ~90 seconds
  const words = script.split(/\s+/);
  const trimmedScript = words.slice(0, 500).join(" ");

  let audioData: ArrayBuffer | null = null;

  // Strategy 1: ElevenLabs (best quality — primary)
  if (!audioData && ELEVENLABS_KEY()) {
    audioData = await callElevenLabs(trimmedScript, lang, effectiveVoiceId);
  }

  // Strategy 2: OpenAI TTS (fallback if ElevenLabs fails or unavailable)
  if (!audioData && OPENAI_KEY()) {
    audioData = await callOpenAI(trimmedScript, lang);
  }

  if (!audioData) {
    return new Response(JSON.stringify({ error: "TTS unavailable", fallback: "browser" }), {
      status: 503, headers: { "Content-Type": "application/json" }
    });
  }

  // Cache for 30 days
  try {
    await store.set(cacheKey, audioData, {
      metadata: { jobId, lang, generatedAt: new Date().toISOString() }
    });
  } catch {}

  return new Response(audioData, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=2592000",
      "X-Cache": "MISS",
    }
  });
};

async function callOpenAI(script: string, lang: string): Promise<ArrayBuffer | null> {
  try {
    // Use a calm, clear voice — nova for English, alloy for Korean
    const voice = lang === "ko" ? "alloy" : "nova";
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1-hd",
        input: script,
        voice,
        response_format: "mp3",
        speed: 0.95,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "unknown");
      console.error("OpenAI TTS error:", res.status, err);
      return null;
    }
    return await res.arrayBuffer();
  } catch (e) {
    console.error("OpenAI TTS exception:", e);
    return null;
  }
}

async function callElevenLabs(script: string, lang: string, voiceId?: string): Promise<ArrayBuffer | null> {
  const selectedVoice = voiceId || (lang === "ko" ? ELEVENLABS_VOICE_KO : ELEVENLABS_VOICE_EN);
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${selectedVoice}`, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_KEY(),
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: script,
        model_id: lang === "ko" ? "eleven_multilingual_v2" : "eleven_multilingual_v2",
        voice_settings: { stability: 0.45, similarity_boost: 0.80, style: 0.35, use_speaker_boost: true },
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "unknown");
      console.error("ElevenLabs TTS error:", res.status, err);
      return null;
    }
    return await res.arrayBuffer();
  } catch (e) {
    console.error("ElevenLabs TTS exception:", e);
    return null;
  }
}

export const config: Config = { path: "/api/audio-briefing" };
