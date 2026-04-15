-- Add missing JSONB columns to users table for data persistence across devices
-- Run this in Supabase SQL Editor: https://suqjdctajnitxivczjtg.supabase.co

ALTER TABLE users ADD COLUMN IF NOT EXISTS analyzed_episodes JSONB DEFAULT '[]';
ALTER TABLE users ADD COLUMN IF NOT EXISTS listen_history JSONB DEFAULT '[]';
ALTER TABLE users ADD COLUMN IF NOT EXISTS liked_episodes JSONB DEFAULT '[]';
ALTER TABLE users ADD COLUMN IF NOT EXISTS playlists JSONB DEFAULT '[]';

-- Backfill: update analyses rows that have null user_id using email match
-- (only works if user email is stored in analyses or can be inferred)
-- UPDATE analyses SET user_id = u.id
-- FROM users u WHERE analyses.user_id IS NULL AND analyses.url IN (
--   SELECT DISTINCT url FROM analyses WHERE user_id = u.id
-- );

-- Create index for fast user_id lookups on analyses table
CREATE INDEX IF NOT EXISTS idx_analyses_user_id ON analyses(user_id) WHERE user_id IS NOT NULL;
