import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

// Returns 30/90/180-day rolling bias trend for a show
// Used for show profile trend charts (Pro Lens+)
export default async (req: Request) => {
  const url = new URL(req.url);
  const showName = url.searchParams.get("show");
  const days = parseInt(url.searchParams.get("days") || "30", 10);

  if (!showName) {
    return new Response(JSON.stringify({ error: "show param required" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const sbUrl = Netlify.env.get("SUPABASE_URL");
  const sbKey = Netlify.env.get("SUPABASE_SERVICE_KEY");
  if (!sbUrl || !sbKey) {
    return new Response(JSON.stringify({ error: "Supabase not configured" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  const sb = createClient(sbUrl, sbKey, { auth: { persistSession: false } });

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await sb
    .from("analyses")
    .select("episode_title, bias_score, bias_label, dim_factual_density, dim_host_credibility, dim_omission_risk, analyze_count, analyzed_at")
    .ilike("show_name", showName)
    .gte("analyzed_at", since)
    .not("bias_score", "is", null)
    .order("analyzed_at", { ascending: true })
    .limit(100);

  if (error || !data || data.length === 0) {
    return new Response(JSON.stringify({ found: false, episodes: [] }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  }

  // Build rolling average points for chart
  const points = data.map((r, i) => {
    // Rolling average of last 3 episodes
    const window = data.slice(Math.max(0, i - 2), i + 1);
    const avg = Math.round(window.reduce((s, w) => s + (w.bias_score || 0), 0) / window.length);
    return {
      date: r.analyzed_at?.split("T")[0],
      biasScore: r.bias_score,
      rollingAvg: avg,
      biasLabel: r.bias_label,
      episodeTitle: r.episode_title,
      factualDensity: r.dim_factual_density,
      hostCredibility: r.dim_host_credibility,
      omissionRisk: r.dim_omission_risk,
    };
  });

  const scores = data.map(r => r.bias_score || 0);
  const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const trend = scores.length > 1
    ? scores[scores.length - 1] > scores[0] + 10 ? "trending_right"
    : scores[scores.length - 1] < scores[0] - 10 ? "trending_left"
    : "stable"
    : "stable";

  return new Response(JSON.stringify({
    found: true,
    showName,
    days,
    episodeCount: data.length,
    avgBiasScore: avgScore,
    trend,
    points,
  }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=1800" }
  });
};

export const config: Config = { path: "/api/show-trend" };
