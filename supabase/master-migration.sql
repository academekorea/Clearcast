-- Podlens Master Migration — Part 20
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql/new
-- Safe to run multiple times (all use IF NOT EXISTS / IF EXISTS)

-- ── USERS TABLE ADDITIONS ──────────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS smart_queue_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS smart_queue_max_shows INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS weekly_digest_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_podcaster BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS social_links JSONB,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deletion_scheduled_at TIMESTAMPTZ;

-- ── FOLLOWED_SHOWS TABLE ADDITIONS ────────────────────────────────────────────

ALTER TABLE followed_shows
  ADD COLUMN IF NOT EXISTS smart_queue BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_episode_id TEXT,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS feed_url TEXT,
  ADD COLUMN IF NOT EXISTS artwork_url TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';

-- ── SHOWS TABLE ADDITIONS ─────────────────────────────────────────────────────

ALTER TABLE shows
  ADD COLUMN IF NOT EXISTS social_links JSONB;

-- ── SAVED_EPISODES TABLE ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS saved_episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  episode_url TEXT NOT NULL,
  episode_title TEXT,
  show_name TEXT,
  artwork_url TEXT,
  saved_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE saved_episodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_saves" ON saved_episodes;
CREATE POLICY "users_own_saves" ON saved_episodes
  FOR ALL USING (auth.uid() = user_id);

-- ── ANALYSIS_QUEUE RLS (drop duplicate policy first) ──────────────────────────

DROP POLICY IF EXISTS "users_own_queue" ON analysis_queue;
CREATE POLICY "users_own_queue" ON analysis_queue
  FOR ALL USING (auth.uid() = user_id);
