import type { Config } from "@netlify/functions";
import { getSupabaseAdmin, sbInsert, trackEvent } from "./lib/supabase.js";

// CSV export — Studio plan only
// Queries Supabase analyses table for user's analyses

function escapeCsv(val: unknown): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

const CSV_HEADERS = [
  'date', 'show', 'episode', 'bias_label', 'left_pct', 'center_pct', 'right_pct',
  'host_trust_score', 'top_finding', 'share_url'
];

export default async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const { userId, plan } = body;

  if (plan !== 'studio') {
    return new Response(JSON.stringify({ error: 'Studio plan required for CSV export' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!userId) {
    return new Response(JSON.stringify({ error: 'userId required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const sb = getSupabaseAdmin();
  if (!sb) {
    return new Response(JSON.stringify({ error: 'Database not configured' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: analyses, error } = await sb
    .from('analyses')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10000);

  if (error) {
    return new Response(JSON.stringify({ error: 'Export failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  const rows = (analyses || []).map((a: any) => [
    a.created_at ? new Date(a.created_at).toLocaleDateString('en-US') : '',
    a.show_name || '',
    a.episode_title || '',
    a.bias_label || '',
    a.bias_left_pct ?? '',
    a.bias_center_pct ?? '',
    a.bias_right_pct ?? '',
    a.host_trust_score ?? '',
    a.flags?.[0]?.title || '',
    a.share_id ? `https://podlens.app/analysis/${a.share_id}` : '',
  ].map(escapeCsv).join(','));

  const csv = [CSV_HEADERS.join(','), ...rows].join('\n');

  // Track
  trackEvent(userId, 'csv_exported', { count: rows.length }, { tierAtTime: plan });
  sbInsert('downloads', {
    user_id: userId,
    analysis_id: null,
    download_type: 'csv',
    created_at: new Date().toISOString(),
  }).catch(() => {});

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="podlens-analyses-${new Date().toISOString().slice(0,10)}.csv"`,
    },
  });
};

export const config: Config = { path: '/api/export-csv' };
