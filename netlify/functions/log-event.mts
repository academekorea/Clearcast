import type { Config } from "@netlify/functions";
import { trackEvent } from "./lib/supabase.js";

// Public event logging endpoint — called from frontend
// Rate-limited by Netlify; no auth required (events are non-sensitive)

const ALLOWED_EVENTS = new Set([
  'analysis_started', 'analysis_completed',
  'player_started', 'spotify_connected', 'youtube_connected', 'apple_connected',
  'share_created', 'share_viewed',
  'pdf_downloaded', 'csv_exported',
  'upgrade_modal_shown', 'upgrade_clicked', 'feature_gate_hit',
  'live_analysis_started', 'page_view',
]);

export default async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const body = await req.json();
    const { event_type, user_id, properties = {}, region, tier, source } = body;

    if (!event_type || !ALLOWED_EVENTS.has(event_type)) {
      return new Response(JSON.stringify({ error: 'Invalid event type' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    trackEvent(user_id, event_type, properties, { region, tierAtTime: tier, source: source || 'web' });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch {
    return new Response(JSON.stringify({ ok: false }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const config: Config = { path: '/api/log-event' };
