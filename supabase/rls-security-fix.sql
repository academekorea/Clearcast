-- ============================================================
-- PODLENS — Comprehensive RLS Security Fix
-- Run in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/suqjdctajnitxivczjtg/sql/new
--
-- Safe to run multiple times — all statements are idempotent.
-- Service-role key (used by all Netlify functions) bypasses RLS
-- automatically, so no backend functions will break.
-- ============================================================

-- ── STEP 1: Enable RLS on every public table ─────────────────
-- IF NOT EXISTS is not needed here — ALTER TABLE ... ENABLE ROW LEVEL
-- SECURITY is a no-op if already enabled.

ALTER TABLE IF EXISTS analyses            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS analysis_queue      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS backup_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS connected_accounts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS downloads           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS followed_shows      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS notifications       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS push_subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS saved_episodes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS shows               ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stories             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS subscriptions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS usage               ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_devices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS users               ENABLE ROW LEVEL SECURITY;

-- ── STEP 2: Drop old policies (clean slate, prevents duplicates) ──

DROP POLICY IF EXISTS "users_own_analyses"            ON analyses;
DROP POLICY IF EXISTS "users_own_queue"               ON analysis_queue;
DROP POLICY IF EXISTS "users_own_connected_accounts"  ON connected_accounts;
DROP POLICY IF EXISTS "users_own_downloads"           ON downloads;
DROP POLICY IF EXISTS "users_own_events"              ON events;
DROP POLICY IF EXISTS "service_insert_events"         ON events;
DROP POLICY IF EXISTS "users_own_followed_shows"      ON followed_shows;
DROP POLICY IF EXISTS "users_own_notifications"       ON notifications;
DROP POLICY IF EXISTS "users_own_push_subscriptions"  ON push_subscriptions;
DROP POLICY IF EXISTS "users_own_saves"               ON saved_episodes;
DROP POLICY IF EXISTS "shows_public_read"             ON shows;
DROP POLICY IF EXISTS "stories_public_read"           ON stories;
DROP POLICY IF EXISTS "users_own_subscriptions"       ON subscriptions;
DROP POLICY IF EXISTS "users_own_usage"               ON usage;
DROP POLICY IF EXISTS "users_own_devices"             ON user_devices;
DROP POLICY IF EXISTS "users_own_sessions"            ON user_sessions;
DROP POLICY IF EXISTS "users_own_profile"             ON users;
DROP POLICY IF EXISTS "users_update_own_profile"      ON users;

-- ── STEP 3: Create policies ───────────────────────────────────

-- analyses: read/write own rows only
CREATE POLICY "users_own_analyses"
  ON analyses FOR ALL
  USING      (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- analysis_queue: read/write own rows only
CREATE POLICY "users_own_queue"
  ON analysis_queue FOR ALL
  USING      (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- backup_log: no client access — service role only (bypasses RLS)
-- No policy needed; RLS is enabled above so anonymous reads are blocked.

-- connected_accounts: users manage their own platform connections
CREATE POLICY "users_own_connected_accounts"
  ON connected_accounts FOR ALL
  USING      (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- downloads: users read their own downloaded briefings
CREATE POLICY "users_own_downloads"
  ON downloads FOR SELECT
  USING (auth.uid()::text = user_id::text);

-- events: users read their own events; service role handles all writes
CREATE POLICY "users_own_events"
  ON events FOR SELECT
  USING (auth.uid()::text = user_id::text);

-- followed_shows: users manage their own show library
CREATE POLICY "users_own_followed_shows"
  ON followed_shows FOR ALL
  USING      (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- notifications: users manage their own notifications
CREATE POLICY "users_own_notifications"
  ON notifications FOR ALL
  USING      (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- push_subscriptions: users read their own device registrations
CREATE POLICY "users_own_push_subscriptions"
  ON push_subscriptions FOR SELECT
  USING (auth.uid()::text = user_id::text);

-- saved_episodes: users manage their own saves
CREATE POLICY "users_own_saves"
  ON saved_episodes FOR ALL
  USING      (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- shows: public podcast metadata — anyone authenticated can read;
-- service role handles all inserts/updates (RLS bypass)
CREATE POLICY "shows_public_read"
  ON shows FOR SELECT
  USING (true);

-- stories: public podcast highlights — same as shows
CREATE POLICY "stories_public_read"
  ON stories FOR SELECT
  USING (true);

-- subscriptions: users read their own billing record;
-- service role (Stripe webhook) handles all writes
CREATE POLICY "users_own_subscriptions"
  ON subscriptions FOR SELECT
  USING (auth.uid()::text = user_id::text);

-- usage: users read their own usage counters;
-- service role handles all writes
CREATE POLICY "users_own_usage"
  ON usage FOR SELECT
  USING (auth.uid()::text = user_id::text);

-- user_devices: users read their own registered devices
CREATE POLICY "users_own_devices"
  ON user_devices FOR SELECT
  USING (auth.uid()::text = user_id::text);

-- user_sessions: users read their own sessions
CREATE POLICY "users_own_sessions"
  ON user_sessions FOR SELECT
  USING (auth.uid()::text = user_id::text);

-- users: users read and update only their own profile row
CREATE POLICY "users_own_profile"
  ON users FOR SELECT
  USING (auth.uid()::text = id::text);

CREATE POLICY "users_update_own_profile"
  ON users FOR UPDATE
  USING      (auth.uid()::text = id::text)
  WITH CHECK (auth.uid()::text = id::text);

-- ── STEP 4: Verify — every row should show rowsecurity = true ──

SELECT
  tablename,
  rowsecurity,
  CASE WHEN rowsecurity THEN '✅ RLS on' ELSE '❌ RLS OFF — NEEDS FIX' END AS status
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- ── STEP 5: Verify policy count per table ─────────────────────

SELECT
  tablename,
  COUNT(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;
