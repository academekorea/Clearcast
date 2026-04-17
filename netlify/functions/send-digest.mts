import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { getSupabaseAdmin } from "./lib/supabase.js";
import { sendEmail, weeklyDigestEmail } from "./lib/email.js";

// Weekly Bias Digest — Monday midnight UTC = 9am KST
// Sends to all Creator+ users who analyzed episodes in the last 7 days

function getWeekNumber(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${week}`;
}

export default async (req: Request) => {
  const week = getWeekNumber();
  const metaStore = getStore("podlens-meta");

  // Idempotency: skip if already sent this week
  try {
    const log = await metaStore.get(`digest-sent-${week}`, { type: "json" }) as any;
    if (log?.sent) {
      return new Response(JSON.stringify({ skipped: true, week }), { status: 200 });
    }
  } catch {}

  const sb = getSupabaseAdmin();
  let digestsSent = 0;
  const errors: string[] = [];

  try {
    if (sb) {
      // Query Supabase: users with analyses in last 7 days
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      // Include all tiers — pricing promises weekly digest to all users
      const { data: userRows } = await sb
        .from('users')
        .select('id,email,name,tier')
        .not('email', 'is', null);

      if (userRows) {
        for (const user of userRows) {
          try {
            if (!user.email) continue;

            // Get their analyses this week
            const { data: analyses } = await sb
              .from('analyses')
              .select('show_name,episode_title,bias_label,share_id,created_at')
              .eq('user_id', user.id)
              .gte('created_at', weekAgo)
              .order('created_at', { ascending: false })
              .limit(5);

            if (!analyses || analyses.length === 0) continue;

            const ok = await sendEmail({
              to: user.email,
              subject: `📊 Your Podlens week — ${analyses.length} episode${analyses.length !== 1 ? 's' : ''} analyzed`,
              html: weeklyDigestEmail({
                name: user.name || 'Listener',
                analyses: analyses.map(a => ({
                  showName: a.show_name || '',
                  episodeTitle: a.episode_title || '',
                  biasLabel: a.bias_label || 'Analyzed',
                  url: a.share_id ? `https://podlens.app/analysis/${a.share_id}` : 'https://podlens.app/library',
                })),
                totalCount: analyses.length,
              }),
            });

            if (ok) digestsSent++;
          } catch (e: any) {
            errors.push(e?.message || 'unknown');
          }
        }
      }
    }

    await metaStore.setJSON(`digest-sent-${week}`, {
      sent: true, sentAt: new Date().toISOString(), count: digestsSent,
    }).catch(() => {});

  } catch (e: any) {
    return new Response(JSON.stringify({ error: "Digest processing error" }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, week, digestsSent, errors: errors.slice(0, 5) }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};

export const config: Config = {
  schedule: '0 0 * * 1', // Monday midnight UTC = 9am KST
};
