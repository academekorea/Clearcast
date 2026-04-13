-- ── PodLens Schema Fix — Add missing columns referenced by code ──────────────
-- Run in Supabase → SQL Editor
-- Fixes all column mismatches found during audit (2026-04-13)

-- ── analyses table — missing columns ─────────────────────────────────────────
DO $$ BEGIN
  -- Share functionality
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='share_id') THEN
    ALTER TABLE analyses ADD COLUMN share_id text UNIQUE DEFAULT encode(gen_random_bytes(8), 'hex');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='share_count') THEN
    ALTER TABLE analyses ADD COLUMN share_count integer DEFAULT 0;
  END IF;

  -- Bias percentage breakdown (computed from bias_score on write)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='bias_left_pct') THEN
    ALTER TABLE analyses ADD COLUMN bias_left_pct integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='bias_center_pct') THEN
    ALTER TABLE analyses ADD COLUMN bias_center_pct integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='bias_right_pct') THEN
    ALTER TABLE analyses ADD COLUMN bias_right_pct integer;
  END IF;

  -- Show artwork for share cards
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='show_artwork') THEN
    ALTER TABLE analyses ADD COLUMN show_artwork text;
  END IF;
END $$;

-- ── notifications table — missing url column ─────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='url') THEN
    ALTER TABLE notifications ADD COLUMN url text;
  END IF;
END $$;

-- ── users table — missing columns for Stripe/deletion ───────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='payment_grace_until') THEN
    ALTER TABLE users ADD COLUMN payment_grace_until timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='interests_updated_at') THEN
    ALTER TABLE users ADD COLUMN interests_updated_at timestamptz;
  END IF;
END $$;

-- ── downloads table — doesn't exist yet ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS downloads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text REFERENCES users(id) ON DELETE CASCADE,
  analysis_id     uuid,
  download_type   text,  -- 'csv' | 'pdf_basic' | 'pdf_full'
  created_at      timestamptz DEFAULT now()
);

-- ── Unique index on canonical_key (was missing from live DB) ─────────────────
-- Already created via user action, but included here for completeness
CREATE UNIQUE INDEX IF NOT EXISTS analyses_canonical_key_idx
  ON analyses(canonical_key) WHERE canonical_key IS NOT NULL;

-- ── Index on share_id for fast lookups ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS analyses_share_id_idx ON analyses(share_id)
  WHERE share_id IS NOT NULL;

SELECT 'Schema fix complete ✅' as status;
