import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { getSupabaseAdmin, sbUpdate, trackEvent } from "./lib/supabase.js";

// Returns analysis data for public share pages
// Also increments share_count + tracks share_viewed event

export default async (req: Request) => {
  const url = new URL(req.url);
  const parts = url.pathname.split('/');
  const shareId = parts[parts.length - 1];

  if (!shareId) {
    return new Response(JSON.stringify({ error: 'Share ID required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Try Supabase first (has share_id)
    const sb = getSupabaseAdmin();
    if (sb) {
      const { data } = await sb
        .from('analyses')
        .select('*')
        .eq('share_id', shareId)
        .single();

      if (data) {
        // Increment share_count
        sb.from('analyses').update({ share_count: (data.share_count || 0) + 1 }).eq('share_id', shareId).then(({ error }) => { if (error) console.error('[share] update error:', error.message); });
        trackEvent(null, 'share_viewed', { share_id: shareId, show_name: data.show_name });

        return new Response(JSON.stringify({
          shareId,
          episodeTitle: data.episode_title,
          showName: data.show_name,
          showArtwork: data.show_artwork,
          biasLabel: data.bias_label,
          audioLean: {
            leftPct: data.bias_left_pct,
            centerPct: data.bias_center_pct,
            rightPct: data.bias_right_pct,
          },
          summary: data.summary,
          hostTrustScore: data.host_trust_score,
          shareCount: data.share_count,
          createdAt: data.created_at,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
        });
      }
    }

    // Fall back to Blobs (jobId = shareId for older analyses)
    const store = getStore('podlens-jobs');
    const job = await store.get(shareId, { type: 'json' }) as any;

    if (!job || (job.status !== 'complete' && job.status !== 'partial')) {
      return new Response(JSON.stringify({ error: 'Analysis not found' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    trackEvent(null, 'share_viewed', { share_id: shareId, show_name: job.showName });

    const al = job.audioLean || {};
    return new Response(JSON.stringify({
      shareId,
      episodeTitle: job.episodeTitle,
      showName: job.showName,
      showArtwork: job.showArtwork,
      biasLabel: job.biasLabel,
      audioLean: { leftPct: al.leftPct ?? 0, centerPct: al.centerPct ?? 0, rightPct: al.rightPct ?? 0 },
      summary: job.summary,
      hostTrustScore: job.hostTrustScore,
      flags: (job.flags || []).slice(0, 3),
      shareCount: 0,
      createdAt: new Date(job.createdAt || Date.now()).toISOString(),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'Server error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const config: Config = { path: '/api/share/:shareId' };
