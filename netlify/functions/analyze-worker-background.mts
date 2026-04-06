import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { AssemblyAI } from "assemblyai";

function isValidUUID(str: any): boolean {
  if (!str) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

export default async (req: Request) => {
  const headers = { "Content-Type": "application/json" };
  let jobId: string | undefined;
  let supabase: ReturnType<typeof createClient> | undefined;

  try {
    const body = await req.json().catch(() => ({})) as any;
    jobId = body.jobId;
    const { audioUrl, showTitle, episodeTitle, userId } = body;

    if (!jobId || !audioUrl) {
      return new Response(JSON.stringify({ error: "Missing jobId or audioUrl" }), { status: 400, headers });
    }

    console.log("[worker] Starting job:", jobId);
    console.log("[worker] Audio URL:", audioUrl.substring(0, 80));

    const supabaseUrl = Netlify.env.get("SUPABASE_URL");
    const supabaseKey = Netlify.env.get("SUPABASE_SERVICE_KEY");
    if (!supabaseUrl || !supabaseKey) throw new Error("Supabase not configured");

    supabase = createClient(supabaseUrl, supabaseKey);

    // ── Transcribe with AssemblyAI SDK (handles all polling automatically) ─
    const aai = new AssemblyAI({ apiKey: Netlify.env.get("ASSEMBLYAI_API_KEY")! });

    console.log("[worker] Submitting to AssemblyAI...");
    const transcript = await aai.transcripts.transcribe({ audio_url: audioUrl });

    if (transcript.status === "error") {
      throw new Error("Transcription failed: " + transcript.error);
    }

    console.log("[worker] Transcript ready, length:", transcript.text?.length);

    // ── Update status to analyzing ────────────────────────────────────────
    await supabase.from("analysis_queue").update({ status: "analyzing" }).eq("id", jobId);

    // ── Claude analysis (raw fetch — no SDK needed) ───────────────────────
    const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) throw new Error("Anthropic API not configured");

    console.log("[worker] Sending to Claude...");
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        messages: [{
          role: "user",
          content: `Analyze this podcast transcript for political bias.
Return ONLY valid JSON with no extra text:
{
  "bias_score": <number -100 to 100>,
  "bias_label": "<Far Left|Left-Leaning|Lightly Left-Leaning|Mostly Balanced|Lightly Right-Leaning|Right-Leaning|Far Right>",
  "summary": "<2 sentence summary>",
  "findings": [
    {"text": "<finding>", "type": "<left|right|neutral>"}
  ],
  "host_trust_score": <number 0-100>,
  "missing_perspectives": "<text>",
  "framing_notes": "<text>"
}

Transcript:
${transcript.text?.substring(0, 8000)}`,
        }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      throw new Error("Claude API error: " + errText.substring(0, 200));
    }

    const cd = await claudeRes.json() as any;
    const rawText = (cd.content?.[0]?.text || "{}").replace(/```json|```/g, "").trim();
    console.log("[worker] Raw analysis:", rawText.substring(0, 100));

    let analysis: any;
    try {
      analysis = JSON.parse(rawText);
    } catch {
      throw new Error("Failed to parse Claude response: " + rawText.substring(0, 200));
    }

    console.log("[worker] Analysis parsed, bias_label:", analysis.bias_label);

    // ── Save to analyses table ────────────────────────────────────────────
    const { data: saved, error: saveError } = await supabase
      .from("analyses")
      .insert({
        user_id: isValidUUID(userId) ? userId : null,
        show_name: showTitle,
        episode_title: episodeTitle,
        source_url: audioUrl,
        source_type: "podcast",
        bias_score: analysis.bias_score,
        bias_label: analysis.bias_label,
        plain_summary: analysis.summary,
        top_findings: analysis.findings,
        host_trust_score: analysis.host_trust_score,
        transcript_excerpt: transcript.text?.substring(0, 50000),
        result_json: analysis,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (saveError) {
      console.error("[worker] Save error:", JSON.stringify(saveError));
      throw new Error("Save failed: " + saveError.message);
    }

    console.log("[worker] Saved to analyses, ID:", saved.id);

    // ── Mark job complete ─────────────────────────────────────────────────
    await supabase.from("analysis_queue").update({
      status: "complete",
      analysis_id: saved.id,
      completed_at: new Date().toISOString(),
    }).eq("id", jobId);

    console.log("[worker] Job complete!");

    return new Response(
      JSON.stringify({ success: true, analysisId: saved.id }),
      { status: 200, headers }
    );

  } catch (err: any) {
    console.error("[worker] FATAL ERROR:", err?.message);
    if (jobId && supabase) {
      await supabase
        .from("analysis_queue")
        .update({ status: "error", error: err?.message || "Unknown error" })
        .eq("id", jobId)
        .catch(() => {});
    }
    return new Response(
      JSON.stringify({ error: err?.message || "Unknown error" }),
      { status: 500, headers }
    );
  }
};

export const config: Config = { path: "/api/analyze-worker" };
