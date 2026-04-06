-- PODLENS — Backup System Migration
-- Run in Supabase SQL Editor: https://suqjdctajnitxivczjtg.supabase.co
-- ============================================================

-- STEP 1: Add backup columns to analyses table
ALTER TABLE IF EXISTS analyses
  ADD COLUMN IF NOT EXISTS result_json JSONB,
  ADD COLUMN IF NOT EXISTS cache_key TEXT,
  ADD COLUMN IF NOT EXISTS cached_at TIMESTAMPTZ;

-- STEP 2: Create indexes for fast cache lookup
CREATE INDEX IF NOT EXISTS analyses_cache_key_idx ON analyses (cache_key);
CREATE INDEX IF NOT EXISTS analyses_result_json_idx ON analyses USING GIN (result_json)
  WHERE result_json IS NOT NULL;

-- STEP 3: Create backup_log table
CREATE TABLE IF NOT EXISTS backup_log (
  id           BIGSERIAL PRIMARY KEY,
  backup_date  TEXT NOT NULL,
  success      BOOLEAN NOT NULL DEFAULT false,
  row_counts   JSONB,
  error_message TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- STEP 4: Enable RLS on backup_log (admin-only via service role)
ALTER TABLE IF EXISTS backup_log ENABLE ROW LEVEL SECURITY;

-- No public read policy — service role bypasses RLS
-- Admins access via service key only

-- STEP 5: Index for backup log lookups
CREATE INDEX IF NOT EXISTS backup_log_date_idx ON backup_log (backup_date DESC);
CREATE INDEX IF NOT EXISTS backup_log_success_idx ON backup_log (success, created_at DESC);

-- STEP 6: Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'analyses'
  AND column_name IN ('result_json', 'cache_key', 'cached_at')
ORDER BY column_name;

SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename = 'backup_log';
