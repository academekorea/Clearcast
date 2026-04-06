import type { Config } from "@netlify/functions";

/**
 * test-analyze — diagnostic endpoint, check before debugging analysis issues.
 * GET https://podlens.app/.netlify/functions/test-analyze
 */
export default async (req: Request) => {
  const diagnostics: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    node_version: process.version,
    env_vars: {
      ASSEMBLYAI_API_KEY: !!Netlify.env.get("ASSEMBLYAI_API_KEY"),
      ANTHROPIC_API_KEY:  !!Netlify.env.get("ANTHROPIC_API_KEY"),
      SUPABASE_URL:       !!Netlify.env.get("SUPABASE_URL"),
      SUPABASE_SERVICE_KEY: !!Netlify.env.get("SUPABASE_SERVICE_KEY"),
      YOUTUBE_API_KEY:    !!Netlify.env.get("YOUTUBE_API_KEY"),
      AUDIO_SERVICE_URL:  !!Netlify.env.get("AUDIO_SERVICE_URL"),
    },
  };

  // Test RSS feed fetch — extract real audio URL
  let realAudioUrl: string | null = null;
  try {
    const rssRes = await fetch("https://lexfridman.com/feed/podcast/", {
      headers: { "User-Agent": "Podlens/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    const text = await rssRes.text();
    const enclosureMatch = text.match(/<enclosure[^>]+url="([^"]{10,2000})"/i);
    realAudioUrl = enclosureMatch ? enclosureMatch[1].replace(/&amp;/g, "&") : null;
    diagnostics.rss_fetch = {
      status: rssRes.status,
      ok: rssRes.ok,
      content_type: rssRes.headers.get("content-type"),
      body_length: text.length,
      has_items: text.includes("<item>"),
      first_audio_url: realAudioUrl,           // full URL — not truncated
      audio_url_length: realAudioUrl?.length,
      audio_url_valid: realAudioUrl?.startsWith("http"),
    };
  } catch (err: any) {
    diagnostics.rss_fetch = { error: err?.message };
  }

  // Test AssemblyAI account validity
  try {
    const key = Netlify.env.get("ASSEMBLYAI_API_KEY");
    if (key) {
      const accountRes = await fetch("https://api.assemblyai.com/v2/account", {
        headers: { authorization: key },
        signal: AbortSignal.timeout(5000),
      });
      const accountData = await accountRes.json().catch(() => null);
      diagnostics.assemblyai_account_status = accountRes.status;
      diagnostics.assemblyai_account = accountData;
    } else {
      diagnostics.assemblyai_account_status = "no key";
    }
  } catch (err: any) {
    diagnostics.assemblyai_account_status = "error";
    diagnostics.assemblyai_account_error = err?.message;
  }

  // Test AssemblyAI submission with the real audio URL from the RSS feed
  try {
    const key = Netlify.env.get("ASSEMBLYAI_API_KEY");
    if (key && realAudioUrl) {
      const requestBody = { audio_url: realAudioUrl, speech_models: ["universal-2"] };
      diagnostics.assemblyai_request_body = requestBody;
      const aaiRes = await fetch("https://api.assemblyai.com/v2/transcript", {
        method: "POST",
        headers: { authorization: key, "content-type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(8000),
      });
      const aaiData = await aaiRes.json().catch(() => null);
      diagnostics.assemblyai_submit_status = aaiRes.status;
      diagnostics.assemblyai_submit_response = aaiData; // full response including any error message

      // If submission succeeded, delete the test transcript immediately to avoid charges
      if (aaiRes.status === 200 && aaiData?.id) {
        await fetch(`https://api.assemblyai.com/v2/transcript/${aaiData.id}`, {
          method: "DELETE",
          headers: { authorization: key },
        }).catch(() => {});
        diagnostics.assemblyai_test_transcript_deleted = true;
      }
    } else if (!key) {
      diagnostics.assemblyai_submit_status = "no key";
    } else {
      diagnostics.assemblyai_submit_status = "skipped — no audio URL from RSS";
    }
  } catch (err: any) {
    diagnostics.assemblyai_submit_status = "error";
    diagnostics.assemblyai_submit_error = err?.message;
  }

  return new Response(JSON.stringify(diagnostics, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = { path: "/api/test-analyze" };
