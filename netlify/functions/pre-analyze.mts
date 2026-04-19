import type { Config } from "@netlify/functions";
import { getSupabaseAdmin, trackEvent } from "./lib/supabase.js";
import { sendEmail, preAnalysisReadyEmail } from "./lib/email.js";

// Scheduled: every hour — check for new episodes on pre-analysis shows
// Only runs for Operator+ users who enabled pre-analysis
// TEMPORARILY DISABLED — re-enable when AssemblyAI budget allows
export default async () => { console.log("[pre-analyze] Disabled to conserve AssemblyAI credits"); return; };
/*

const MAX_SHOWS_FREE = 0;
const MAX_SHOWS_OPERATOR = 5;
const MAX_SHOWS_STUDIO = 999;

async function fetchLatestEpisode(feedUrl: string): Promise<{
  guid: string; title: string; enclosureUrl: string | null; pubDate: string
} | null> {
  try {
    const res = await fetch(feedUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const xml = await res.text();

    // Parse first item
    const itemMatch = xml.match(/<item[\s>][\s\S]*?<\/item>/i);
    if (!itemMatch) return null;
    const item = itemMatch[0];

    const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const guidMatch = item.match(/<guid[^>]*>([^<]+)<\/guid>/i);
    const enclosureMatch = item.match(/<enclosure[^>]+url="([^"]+)"/i);
    const pubDateMatch = item.match(/<pubDate>([^<]+)<\/pubDate>/i);

    return {
      guid: guidMatch?.[1]?.trim() || '',
      title: titleMatch?.[1]?.trim() || 'New Episode',
      enclosureUrl: enclosureMatch?.[1] || null,
      pubDate: pubDateMatch?.[1]?.trim() || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function triggerAnalysis(opts: {
  feedUrl: string;
  episodeUrl: string;
  episodeTitle: string;
  showName: string;
  showArtwork: string;
  userId: string;
}): Promise<{ jobId: string | null; biasLabel?: string; leftPct?: number; centerPct?: number; rightPct?: number }> {
  try {
    // POST to our own /api/analyze endpoint
    const site = 'https://podlens.app';
    const res = await fetch(`${site}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: opts.episodeUrl,
        showName: opts.showName,
        showArtwork: opts.showArtwork,
        episodeTitle: opts.episodeTitle,
        userId: opts.userId,
        userPlan: 'operator',
        isPreAnalysis: true,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return { jobId: null };
    const data = await res.json();
    return {
      jobId: data.jobId || null,
      biasLabel: data.biasLabel,
      leftPct: data.audioLean?.leftPct ?? 0,
      centerPct: data.audioLean?.centerPct ?? 0,
      rightPct: data.audioLean?.rightPct ?? 0,
    };
  } catch {
    return { jobId: null };
  }
}

// ── Process analysis_queue items (Smart Queue) ───────────────────────────────
async function processQueueItem(sb: any, item: any): Promise<void> {
  // Mark as processing
  await sb.from('analysis_queue')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('id', item.id);

  try {
    const res = await fetch('https://podlens.app/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: item.episode_url,
        showName: item.show_name,
        episodeTitle: item.episode_title,
        userId: item.user_id,
        userPlan: item.tier,
        isPreAnalysis: true,
        skipLimitCheck: !item.counts_toward_limit,
      }),
      signal: AbortSignal.timeout(60000),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);

    const jobId = data.jobId || data.id || null;
    const analysisUrl = jobId ? `https://podlens.app/analysis/${jobId}` : 'https://podlens.app';

    await sb.from('analysis_queue')
      .update({
        status: 'complete',
        completed_at: new Date().toISOString(),
        analysis_id: jobId,
      })
      .eq('id', item.id);

    // In-app notification
    await sb.from('notifications').insert({
      user_id: item.user_id,
      type: 'smart_queue_ready',
      title: `Analysis ready: ${item.show_name}`,
      body: item.episode_title || 'New episode analyzed',
      url: jobId ? `/analysis/${jobId}` : '/',
      read: false,
      created_at: new Date().toISOString(),
    }).catch(() => {});

    // Email notification
    const { data: user } = await sb.from('users').select('email, name').eq('id', item.user_id).maybeSingle();
    if (user?.email) {
      sendEmail({
        to: user.email,
        subject: `✅ Analysis ready: ${item.episode_title || item.show_name}`,
        html: preAnalysisReadyEmail({
          episodeTitle: item.episode_title || 'New episode',
          showName: item.show_name,
          biasLabel: data.biasLabel || 'Analysis complete',
          leftPct: data.audioLean?.leftPct ?? 0,
          centerPct: data.audioLean?.centerPct ?? 0,
          rightPct: data.audioLean?.rightPct ?? 0,
          topFinding: '',
          analysisUrl,
        }),
      }).catch(() => {});
    }

    console.log(`[pre-analyze] Queue item complete: ${item.episode_title}`);
  } catch (err: any) {
    console.error(`[pre-analyze] Queue item failed:`, err?.message);
    await sb.from('analysis_queue')
      .update({ status: 'failed', error: err?.message || 'Unknown error' })
      .eq('id', item.id);
  }
}

export default async (req: Request) => {
  const sb = getSupabaseAdmin();
  if (!sb) return new Response('Supabase not configured', { status: 500 });

  const adminEmail = Netlify.env.get('ADMIN_EMAIL') || '';
  let processed = 0;
  let errors = 0;

  try {
    // Get all pre-analysis enabled shows for Operator+ users
    const { data: shows, error } = await sb
      .from('followed_shows')
      .select(`
        user_id, show_slug, show_name, show_artwork, feed_url,
        last_episode_guid, pre_analysis_enabled,
        users!inner(id, email, name, tier)
      `)
      .eq('pre_analysis_enabled', true)
      .in('users.tier', ['operator', 'studio']);

    if (error) {
      console.error('[pre-analyze] Query error:', error.message);
      return new Response(JSON.stringify({ error: "Pre-analysis unavailable" }), { status: 500 });
    }

    if (!shows || shows.length === 0) {
      return new Response(JSON.stringify({ processed: 0, message: 'No pre-analysis shows' }), { status: 200 });
    }

    for (const show of shows) {
      const user = (show as any).users;
      if (!user) continue;

      const feedUrl = show.feed_url;
      if (!feedUrl) continue;

      try {
        const latest = await fetchLatestEpisode(feedUrl);
        if (!latest || !latest.guid) continue;

        // Skip if we already analyzed this episode
        if (show.last_episode_guid === latest.guid) continue;

        const episodeUrl = latest.enclosureUrl || feedUrl;

        // Trigger analysis
        const result = await triggerAnalysis({
          feedUrl,
          episodeUrl,
          episodeTitle: latest.title,
          showName: show.show_name,
          showArtwork: show.show_artwork || '',
          userId: show.user_id,
        });

        if (!result.jobId) continue;

        // Update last_episode_guid
        await sb
          .from('followed_shows')
          .update({
            last_episode_guid: latest.guid,
            last_episode_analyzed_at: new Date().toISOString(),
          })
          .eq('user_id', show.user_id)
          .eq('show_slug', show.show_slug);

        const analysisUrl = `https://podlens.app/analysis/${result.jobId}`;

        // Insert notification
        await sb.from('notifications').insert({
          user_id: show.user_id,
          type: 'pre_analysis_ready',
          title: `New ${show.show_name} episode analyzed`,
          body: `"${latest.title}" — ${result.biasLabel || 'Analysis ready'}`,
          url: analysisUrl,
          read: false,
          created_at: new Date().toISOString(),
        }).catch(() => {});

        // Send email
        if (user.email) {
          sendEmail({
            to: user.email,
            subject: `⚡ New ${show.show_name} episode analyzed — ready when you are`,
            html: preAnalysisReadyEmail({
              episodeTitle: latest.title,
              showName: show.show_name,
              biasLabel: result.biasLabel || 'Analysis complete',
              leftPct: result.leftPct ?? 0,
              centerPct: result.centerPct ?? 0,
              rightPct: result.rightPct ?? 0,
              topFinding: '',
              analysisUrl,
            }),
          }).catch(() => {});
        }

        trackEvent(show.user_id, 'pre_analysis_enabled', {
          show_name: show.show_name,
          episode_title: latest.title,
          job_id: result.jobId,
        });

        processed++;
      } catch (e: any) {
        console.error(`[pre-analyze] Error for show ${show.show_slug}:`, e?.message);
        errors++;
      }
    }
  } catch (e: any) {
    console.error('[pre-analyze] Fatal error:', e?.message);
    return new Response(JSON.stringify({ error: "Pre-analysis unavailable" }), { status: 500 });
  }

  // ── Process analysis_queue (Smart Queue — all tiers including Creator) ──────
  let qProcessed = 0;
  let qErrors = 0;
  try {
    const { data: queueItems } = await sb
      .from('analysis_queue')
      .select('*')
      .eq('status', 'pending')
      .order('priority', { ascending: true })
      .order('queued_at', { ascending: true })
      .limit(10);

    if (queueItems?.length) {
      console.log(`[pre-analyze] Processing ${queueItems.length} queue items`);
      for (const item of queueItems) {
        try {
          await processQueueItem(sb, item);
          qProcessed++;
        } catch {
          qErrors++;
        }
      }
    }
  } catch (e: any) {
    console.error('[pre-analyze] Queue processing error:', e?.message);
  }

  return new Response(JSON.stringify({
    processed,
    errors,
    qProcessed,
    qErrors,
    ts: new Date().toISOString(),
  }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};

*/
export const config: Config = {
  schedule: '0 * * * *',  // every hour
};
