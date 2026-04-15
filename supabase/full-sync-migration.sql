-- ============================================================
-- PODLENS: Full Data Sync Migration
-- Run in Supabase SQL Editor (https://suqjdctajnitxivczjtg.supabase.co)
-- Date: April 15, 2026
-- ============================================================

-- ── 1. USER PROFILE COLUMNS ─────────────────────────────────
-- Voice preference (ElevenLabs voice ID)
ALTER TABLE users ADD COLUMN IF NOT EXISTS voice_preference TEXT DEFAULT NULL;

-- Notification preferences (JSON object of toggle states)
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_prefs JSONB DEFAULT '{}';

-- Language preference
ALTER TABLE users ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';

-- Topic affinity (computed from analyses + follows + likes)
ALTER TABLE users ADD COLUMN IF NOT EXISTS topic_affinity JSONB DEFAULT NULL;

-- Bias fingerprint (computed from analysis history)
ALTER TABLE users ADD COLUMN IF NOT EXISTS bias_fingerprint JSONB DEFAULT NULL;

-- Echo chamber score snapshot
ALTER TABLE users ADD COLUMN IF NOT EXISTS echo_chamber JSONB DEFAULT NULL;

-- Spotify metadata
ALTER TABLE users ADD COLUMN IF NOT EXISTS spotify_connected BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS youtube_connected BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS spotify_show_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS spotify_imported_at TIMESTAMPTZ DEFAULT NULL;

-- Smart queue global toggle
ALTER TABLE users ADD COLUMN IF NOT EXISTS smart_queue_enabled BOOLEAN DEFAULT FALSE;

-- ── 2. FOLLOWED_SHOWS COLUMNS ───────────────────────────────
ALTER TABLE followed_shows ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'manual';
ALTER TABLE followed_shows ADD COLUMN IF NOT EXISTS spotify_id TEXT DEFAULT NULL;
ALTER TABLE followed_shows ADD COLUMN IF NOT EXISTS spotify_url TEXT DEFAULT NULL;
ALTER TABLE followed_shows ADD COLUMN IF NOT EXISTS youtube_channel_id TEXT DEFAULT NULL;
ALTER TABLE followed_shows ADD COLUMN IF NOT EXISTS smart_queue BOOLEAN DEFAULT FALSE;
ALTER TABLE followed_shows ADD COLUMN IF NOT EXISTS show_slug TEXT DEFAULT NULL;
ALTER TABLE followed_shows ADD COLUMN IF NOT EXISTS show_artwork TEXT DEFAULT NULL;
ALTER TABLE followed_shows ADD COLUMN IF NOT EXISTS last_episode_guid TEXT DEFAULT NULL;
ALTER TABLE followed_shows ADD COLUMN IF NOT EXISTS last_episode_analyzed_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE followed_shows ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ DEFAULT NULL;

-- ── 3. ANALYSES TABLE COLUMNS ───────────────────────────────
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS host_count INTEGER DEFAULT NULL;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS has_guest BOOLEAN DEFAULT NULL;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS guest_score INTEGER DEFAULT NULL;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS episode_number TEXT DEFAULT NULL;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS host_names JSONB DEFAULT NULL;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS duration_minutes NUMERIC DEFAULT NULL;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS host_trust_score INTEGER DEFAULT NULL;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS show_category TEXT DEFAULT NULL;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS analyze_count INTEGER DEFAULT 1;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS share_id TEXT DEFAULT NULL;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS share_count INTEGER DEFAULT 0;

-- ── 4. INDEXES ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_analyses_user_id ON analyses(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analyses_show_name ON analyses(show_name) WHERE show_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analyses_canonical_key ON analyses(canonical_key);
CREATE INDEX IF NOT EXISTS idx_analyses_analyzed_at ON analyses(analyzed_at DESC);
CREATE INDEX IF NOT EXISTS idx_followed_shows_user ON followed_shows(user_id);
CREATE INDEX IF NOT EXISTS idx_followed_shows_smart_queue ON followed_shows(user_id) WHERE smart_queue = TRUE;
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, event_type);
CREATE INDEX IF NOT EXISTS idx_connected_accounts_user ON connected_accounts(user_id, provider);

-- ── 5. UNIQUE CONSTRAINTS ───────────────────────────────────
-- Prevent duplicate follows (if not already exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_user_show_follow') THEN
    ALTER TABLE followed_shows ADD CONSTRAINT unique_user_show_follow UNIQUE (user_id, show_name);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 6. VERIFY ───────────────────────────────────────────────
-- Run this after to confirm all columns exist:
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users' ORDER BY ordinal_position;
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'followed_shows' ORDER BY ordinal_position;
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'analyses' ORDER BY ordinal_position;
