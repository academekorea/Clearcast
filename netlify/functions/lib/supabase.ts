// Supabase client for Netlify Functions
// Admin client — server-side only, never expose service key to browser
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getStore } from '@netlify/blobs'

// ── Blobs fallback queue ──────────────────────────────────────────────────────
// If Supabase unavailable, queue write in Blobs for retry
async function queueWrite(table: string, data: Record<string, unknown>): Promise<void> {
  try {
    const store = getStore('supabase-queue')
    const key = `queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await store.setJSON(key, { table, data, timestamp: new Date().toISOString() })
  } catch { /* non-critical */ }
}

let _admin: SupabaseClient | null = null
let _public: SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient | null {
  const url = Netlify.env.get('SUPABASE_URL')
  const key = Netlify.env.get('SUPABASE_SERVICE_KEY')
  if (!url || !key) return null
  if (!_admin) _admin = createClient(url, key)
  return _admin
}

export function getSupabasePublic(): SupabaseClient | null {
  const url = Netlify.env.get('SUPABASE_URL')
  const key = Netlify.env.get('SUPABASE_ANON_KEY')
  if (!url || !key) return null
  if (!_public) _public = createClient(url, key)
  return _public
}

// Fire-and-forget Supabase write — falls back to Blobs queue if Supabase unavailable
export async function sbInsert(table: string, data: Record<string, unknown>): Promise<void> {
  try {
    const sb = getSupabaseAdmin()
    if (!sb) { await queueWrite(table, data); return }
    const { error } = await sb.from(table).insert(data)
    if (error) {
      console.error(`[supabase] insert ${table} error:`, error.message, error.code)
      await queueWrite(table, data)
    }
  } catch {
    await queueWrite(table, data)
  }
}

export async function sbUpsert(table: string, data: Record<string, unknown>, onConflict?: string): Promise<void> {
  try {
    const sb = getSupabaseAdmin()
    if (!sb) { await queueWrite(table, data); return }
    const { error } = await sb.from(table).upsert(data, onConflict ? { onConflict } : undefined)
    if (error) {
      console.error(`[supabase] upsert ${table} error:`, error.message, error.code)
      await queueWrite(table, data)
    }
  } catch {
    await queueWrite(table, data)
  }
}

export async function sbUpdate(table: string, match: Record<string, unknown>, data: Record<string, unknown>): Promise<void> {
  try {
    const sb = getSupabaseAdmin()
    if (!sb) return
    let q = sb.from(table).update(data)
    for (const [k, v] of Object.entries(match)) q = (q as any).eq(k, v)
    const { error } = await q
    if (error) console.error(`[supabase] update ${table} error:`, error.message, error.code)
  } catch { /* non-critical */ }
}

// Track event in events table (fire-and-forget)
export function trackEvent(
  userId: string | null | undefined,
  eventType: string,
  properties: Record<string, unknown> = {},
  extra: { region?: string; tierAtTime?: string; source?: string; sessionId?: string | null } = {}
): void {
  sbInsert('events', {
    user_id: userId || null,
    session_id: extra.sessionId || null,
    event_type: eventType,
    properties,
    region: extra.region || null,
    tier_at_time: extra.tierAtTime || null,
    source: extra.source || 'web',
    created_at: new Date().toISOString(),
  }).catch(() => {})
}
