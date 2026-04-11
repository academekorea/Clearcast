import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

// Returns bias data for a given URL or show name from the community analyses table
// Used to show ambient bias badges on non-curated episode cards
export default async (req: Request) => {
  const url = new URL(req.url);
  const episodeUrl = url.searchParams.get("url");
  const showName   = url.searchParams.get("show");
  const mode       = url.searchParams.get("mode") || "episode"; // episode | show | trending

  const sbUrl = Netlify.env.get("SUPABASE_URL");
  const sbKey = Netlify.env.get("SUPABASE_SERVICE_KEY");
  if (!sbUrl || !sbKey) {
    return new Response(JSON.stringify({ error: "Supabase not configured" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  const sb = createClient(sbUrl, sbKey, { auth: { persistSession: false } });

  try {
    // ── Mode: trending — top 20 most analyzed episodes platform-wide ─────────
    if (mode === "trending") {
      const { data } = await sb
        .from("analyses")
        .select("canonical_key, url, show_name, episode_title, bias_score, bias_label, analyze_count, analyzed_at")
        .not("bias_score", "is", null)
        .order("analyze_count", { ascending: false })
        .limit(20);

      return new Response(JSON.stringify({ trending: data || [] }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" }
      });
    }

    // ── Mode: show — aggregate bias across all episodes of a show ─────────────
    if (mode === "show" && showName) {
      const { data } = await sb
        .from("analyses")
        .select("bias_score, analyze_count, analyzed_at, episode_title, bias_label")
        .ilike("show_name", showName)
        .not("bias_score", "is", null)
        .order("analyzed_at", { ascending: false })
        .limit(50);

      if (!data || data.length === 0) {
        return new Response(JSON.stringify({ found: false }), {
          status: 200, headers: { "Content-Type": "application/json" }
        });
      }

      const avgScore = Math.round(data.reduce((s, r) => s + (r.bias_score || 0), 0) / data.length);
      const totalAnalyses = data.reduce((s, r) => s + (r.analyze_count || 1), 0);
      const leftPct  = Math.round(Math.max(0, -avgScore) * 0.5 + 20);
      const rightPct = Math.round(Math.max(0, avgScore)  * 0.5 + 20);
      const centerPct = Math.max(5, 100 - leftPct - rightPct);
      const label = avgScore < -50 ? "Heavily left"
        : avgScore < -20 ? "Leans left"
        : avgScore > 50  ? "Heavily right"
        : avgScore > 20  ? "Leans right"
        : "Mostly balanced";

      return new Response(JSON.stringify({
        found: true,
        showName,
        biasScore: avgScore,
        biasLabel: label,
        leftPct, centerPct, rightPct,
        episodeCount: data.length,
        totalAnalyses,
        recentEpisodes: data.slice(0, 5).map(r => ({
          title: r.episode_title,
          biasScore: r.bias_score,
          biasLabel: r.bias_label,
          date: r.analyzed_at,
        })),
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" }
      });
    }

    // ── Mode: episode — bias data for a specific URL ──────────────────────────
    if (!episodeUrl) {
      return new Response(JSON.stringify({ error: "url or show param required" }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    const { data } = await sb
      .from("analyses")
      .select("canonical_key, url, show_name, episode_title, bias_score, bias_label, analyze_count, dim_perspective_balance, dim_factual_density, dim_source_diversity, dim_framing_patterns, dim_host_credibility, dim_omission_risk, host_trust_score, analyzed_at")
      .or(`url.eq.${episodeUrl},canonical_key.eq.${episodeUrl}`)
      .limit(1)
      .single();

    if (!data) {
      return new Response(JSON.stringify({ found: false }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    const lp = Math.round(Math.max(0, -(data.bias_score || 0)) * 0.5 + 20);
    const rp = Math.round(Math.max(0, (data.bias_score || 0)) * 0.5 + 20);
    const cp = Math.max(5, 100 - lp - rp);

    return new Response(JSON.stringify({
      found: true,
      biasScore: data.bias_score,
      biasLabel: data.bias_label,
      leftPct: lp, centerPct: cp, rightPct: rp,
      analyzeCount: data.analyze_count || 1,
      showName: data.show_name,
      episodeTitle: data.episode_title,
      analyzedAt: data.analyzed_at,
      dimensions: {
        perspectiveBalance: data.dim_perspective_balance,
        factualDensity: data.dim_factual_density,
        sourceDiversity: data.dim_source_diversity,
        framingPatterns: data.dim_framing_patterns,
        hostCredibility: data.dim_host_credibility,
        omissionRisk: data.dim_omission_risk,
      },
      hostTrustScore: data.host_trust_score,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
};

export const config: Config = { path: "/api/community-bias" };
