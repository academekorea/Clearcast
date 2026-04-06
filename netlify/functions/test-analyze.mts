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

  // Test RSS feed fetch
  try {
    const rssRes = await fetch("https://lexfridman.com/feed/podcast/", {
      headers: { "User-Agent": "Podlens/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    const text = await rssRes.text();
    const enclosureMatch = text.match(/<enclosure[^>]+url="([^"]+)"/i);
    diagnostics.rss_fetch = {
      status: rssRes.status,
      ok: rssRes.ok,
      content_type: rssRes.headers.get("content-type"),
      body_length: text.length,
      has_items: text.includes("<item>"),
      first_audio_url: enclosureMatch ? enclosureMatch[1].slice(0, 80) + "..." : null,
    };
  } catch (err: any) {
    diagnostics.rss_fetch = { error: err?.message };
  }

  // Test AssemblyAI connectivity
  try {
    const key = Netlify.env.get("ASSEMBLYAI_API_KEY");
    if (key) {
      const aaiRes = await fetch("https://api.assemblyai.com/v2/transcript", {
        method: "POST",
        headers: { authorization: key, "content-type": "application/json" },
        body: JSON.stringify({ audio_url: "https://example.com/fake.mp3" }),
        signal: AbortSignal.timeout(5000),
      });
      diagnostics.assemblyai_reachable = aaiRes.status !== 0;
      diagnostics.assemblyai_status = aaiRes.status;
    } else {
      diagnostics.assemblyai_reachable = "no key";
    }
  } catch (err: any) {
    diagnostics.assemblyai_reachable = false;
    diagnostics.assemblyai_error = err?.message;
  }

  return new Response(JSON.stringify(diagnostics, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = { path: "/api/test-analyze" };
