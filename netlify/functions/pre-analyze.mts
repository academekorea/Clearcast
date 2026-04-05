import type { Config } from "@netlify/functions";
import { getSupabaseAdmin, trackEvent } from "./lib/supabase.js";
import { sendEmail, preAnalysisReadyEmail } from "./lib/email.js";

// Scheduled: every hour — check for new episodes on pre-analysis shows
// Only runs for Operator+ users who enabled pre-analysis

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
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
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
    return new Response(JSON.stringify({ error: e?.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ processed, errors, ts: new Date().toISOString() }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};

export const config: Config = {
  path: '/api/pre-analyze',
  schedule: '0 * * * *',  // every hour
};
