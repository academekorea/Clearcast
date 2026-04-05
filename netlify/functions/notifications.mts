import type { Config } from "@netlify/functions";
import { getSupabaseAdmin } from "./lib/supabase.js";

export default async (req: Request) => {
  const url = new URL(req.url);
  const userId = url.searchParams.get('userId');
  const action = url.searchParams.get('action'); // 'count' | 'list' | 'mark-read'

  if (!userId) {
    return new Response(JSON.stringify({ error: 'userId required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const sb = getSupabaseAdmin();
  if (!sb) {
    return new Response(JSON.stringify({ count: 0, notifications: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    if (action === 'count') {
      const { count } = await sb
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('read', false);
      return new Response(JSON.stringify({ count: count || 0 }), {
        status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    if (action === 'mark-read') {
      await sb.from('notifications').update({ read: true }).eq('user_id', userId);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Default: list (last 20)
    const { data } = await sb
      .from('notifications')
      .select('id,type,title,body,url,read,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    return new Response(JSON.stringify({ notifications: data || [] }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ count: 0, notifications: [], error: e?.message }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const config: Config = { path: '/api/notifications' };
