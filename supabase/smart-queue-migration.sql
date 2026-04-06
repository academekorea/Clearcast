-- Smart Queue migration
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql/new

-- 1. Add smart queue columns to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS smart_queue_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS smart_queue_max_shows INTEGER DEFAULT 5;

-- 2. Add smart queue columns to followed_shows table
ALTER TABLE followed_shows
  ADD COLUMN IF NOT EXISTS smart_queue BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_episode_id TEXT,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;

-- 3. Create analysis_queue table
CREATE TABLE IF NOT EXISTS analysis_queue (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  show_name      TEXT NOT NULL,
  episode_url    TEXT NOT NULL,
  episode_title  TEXT,
  feed_url       TEXT,
  status         TEXT DEFAULT 'pending',  -- pending | processing | complete | failed
  tier           TEXT NOT NULL,           -- creator | operator | studio
  counts_toward_limit BOOLEAN DEFAULT true,
  priority       INTEGER DEFAULT 5,       -- 1=highest (studio), 2=operator, 5=creator
  queued_at      TIMESTAMPTZ DEFAULT NOW(),
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  analysis_id    UUID,
  error          TEXT
);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_queue_user_status
  ON analysis_queue(user_id, status);
CREATE INDEX IF NOT EXISTS idx_queue_pending
  ON analysis_queue(status, priority, queued_at)
  WHERE status = 'pending';

-- 5. Row level security
ALTER TABLE analysis_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_queue" ON analysis_queue
  FOR ALL USING (auth.uid()::text = user_id::text);
