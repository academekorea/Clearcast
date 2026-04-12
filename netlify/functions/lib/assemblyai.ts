// AssemblyAI helpers — single source of truth for API calls
// Update speech model config HERE, not in individual functions

const ASSEMBLYAI_BASE = "https://api.assemblyai.com/v2";
const SPEECH_MODELS = ["universal-3-pro"];

/** Submit an audio URL for transcription. Returns the transcript ID. */
export async function submitTranscription(
  apiKey: string,
  audioUrl: string,
  opts?: { timeout?: number },
): Promise<{ id: string }> {
  const res = await fetch(`${ASSEMBLYAI_BASE}/transcript`, {
    method: "POST",
    headers: { authorization: apiKey, "content-type": "application/json" },
    body: JSON.stringify({ audio_url: audioUrl, speech_models: SPEECH_MODELS }),
    signal: opts?.timeout ? AbortSignal.timeout(opts.timeout) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    let msg = "Transcription service error";
    try { const j = JSON.parse(text); if (j.error) msg = `Transcription service error: ${j.error}`; } catch { /* */ }
    throw new Error(msg);
  }

  const data = await res.json() as { id: string };
  if (!data.id) throw new Error("Transcription service returned no job ID");
  return data;
}

/** Upload raw audio bytes to AssemblyAI and get an upload URL. */
export async function uploadAudio(
  apiKey: string,
  audioBytes: Uint8Array | Buffer,
): Promise<string> {
  const res = await fetch(`${ASSEMBLYAI_BASE}/upload`, {
    method: "POST",
    headers: { authorization: apiKey, "content-type": "application/octet-stream" },
    body: audioBytes,
  });

  if (!res.ok) throw new Error("Failed to upload audio to AssemblyAI");
  const { upload_url } = await res.json() as { upload_url: string };
  return upload_url;
}

/** Upload raw audio then submit for transcription in one call. */
export async function uploadAndTranscribe(
  apiKey: string,
  audioBytes: Uint8Array | Buffer,
): Promise<{ id: string }> {
  const uploadUrl = await uploadAudio(apiKey, audioBytes);
  return submitTranscription(apiKey, uploadUrl);
}

/** Poll for a transcript result. */
export async function getTranscript(
  apiKey: string,
  transcriptId: string,
  opts?: { timeout?: number },
): Promise<{ status: string; text?: string; audio_duration?: number; words?: any[]; error?: string }> {
  const res = await fetch(`${ASSEMBLYAI_BASE}/transcript/${transcriptId}`, {
    method: "GET",
    headers: { authorization: apiKey },
    signal: opts?.timeout ? AbortSignal.timeout(opts.timeout) : undefined,
  });

  if (!res.ok) throw new Error(`AssemblyAI poll failed: ${res.status}`);
  return res.json() as any;
}
