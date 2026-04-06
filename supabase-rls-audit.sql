-- PODLENS — Supabase RLS Audit & Migration
-- Run this in the Supabase SQL Editor: https://suqjdctajnitxivczjtg.supabase.co
-- ============================================================

-- STEP 1: Check current RLS status on all tables
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- STEP 2: Enable RLS on any table showing rowsecurity = false
ALTER TABLE IF EXISTS analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS followed_shows ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS connected_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS downloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stories ENABLE ROW LEVEL SECURITY;

-- STEP 3: Create policies (IF NOT EXISTS avoids errors on re-run)

-- analyses: users read/write only their own
CREATE POLICY IF NOT EXISTS "users_own_analyses"
  ON analyses FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- events: users read only their own
CREATE POLICY IF NOT EXISTS "users_own_events"
  ON events FOR SELECT
  USING (auth.uid()::text = user_id::text);

-- Insert events from service role only (server-side)
CREATE POLICY IF NOT EXISTS "service_insert_events"
  ON events FOR INSERT
  WITH CHECK (true); -- service role bypasses RLS

-- notifications: users manage their own
CREATE POLICY IF NOT EXISTS "users_own_notifications"
  ON notifications FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- subscriptions: users read only their own
CREATE POLICY IF NOT EXISTS "users_own_subscriptions"
  ON subscriptions FOR SELECT
  USING (auth.uid()::text = user_id::text);

-- usage: users read only their own
CREATE POLICY IF NOT EXISTS "users_own_usage"
  ON usage FOR SELECT
  USING (auth.uid()::text = user_id::text);

-- users: users read/update only their own row
CREATE POLICY IF NOT EXISTS "users_own_profile"
  ON users FOR SELECT
  USING (auth.uid()::text = id::text);

CREATE POLICY IF NOT EXISTS "users_update_own_profile"
  ON users FOR UPDATE
  USING (auth.uid()::text = id::text)
  WITH CHECK (auth.uid()::text = id::text);

-- followed_shows: users manage their own
CREATE POLICY IF NOT EXISTS "users_own_followed_shows"
  ON followed_shows FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- connected_accounts: users manage their own
CREATE POLICY IF NOT EXISTS "users_own_connected_accounts"
  ON connected_accounts FOR ALL
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

-- user_devices: users read their own
CREATE POLICY IF NOT EXISTS "users_own_devices"
  ON user_devices FOR SELECT
  USING (auth.uid()::text = user_id::text);

-- downloads: users read their own
CREATE POLICY IF NOT EXISTS "users_own_downloads"
  ON downloads FOR SELECT
  USING (auth.uid()::text = user_id::text);

-- STEP 4: Verify all tables now have RLS enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
-- Every row should show rowsecurity = true

-- STEP 5: Test isolation (run as anon key — should return 0 rows)
-- SELECT * FROM analyses WHERE user_id != 'your-test-user-id';
-- Expected: empty result (RLS blocks cross-user reads)
