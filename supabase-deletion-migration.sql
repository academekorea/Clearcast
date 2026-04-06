-- PODLENS — Account Soft-Deletion Migration
-- Run in Supabase SQL Editor: https://suqjdctajnitxivczjtg.supabase.co
-- ============================================================

-- STEP 1: Add soft-deletion columns to users table
ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS deletion_scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deletion_date         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS account_status        TEXT DEFAULT 'active';

-- STEP 2: Indexes for the daily hard-delete job
CREATE INDEX IF NOT EXISTS idx_users_deletion
  ON users (deletion_date)
  WHERE deletion_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_status
  ON users (account_status);

-- STEP 3: Verify
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name IN ('deletion_scheduled_at', 'deletion_date', 'account_status')
ORDER BY column_name;
