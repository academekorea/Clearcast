-- ── PodLens analyses table migration ─────────────────────────────────────────
-- Run in Supabase → SQL Editor
-- Adds all missing columns to support:
--   • Community cache (platform-wide analyzed episode store)
--   • analyze_count social proof ("analyzed 847 times")
--   • 6D dimension scores for trend charts
--   • User intelligence profile
--   • Bias fingerprint aggregation

-- Add missing columns (safe — uses IF NOT EXISTS pattern)
DO $$ BEGIN

  -- Core identifiers
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='canonical_key') THEN
    ALTER TABLE analyses ADD COLUMN canonical_key text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='url') THEN
    ALTER TABLE analyses ADD COLUMN url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='job_id') THEN
    ALTER TABLE analyses ADD COLUMN job_id text;
  END IF;

  -- Bias scores
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='bias_score') THEN
    ALTER TABLE analyses ADD COLUMN bias_score integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='bias_label') THEN
    ALTER TABLE analyses ADD COLUMN bias_label text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='factuality_label') THEN
    ALTER TABLE analyses ADD COLUMN factuality_label text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='omission_risk') THEN
    ALTER TABLE analyses ADD COLUMN omission_risk text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='summary') THEN
    ALTER TABLE analyses ADD COLUMN summary text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='bias_reason') THEN
    ALTER TABLE analyses ADD COLUMN bias_reason text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='host_trust_score') THEN
    ALTER TABLE analyses ADD COLUMN host_trust_score integer;
  END IF;

  -- 6D dimension scores
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='dim_perspective_balance') THEN
    ALTER TABLE analyses ADD COLUMN dim_perspective_balance integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='dim_factual_density') THEN
    ALTER TABLE analyses ADD COLUMN dim_factual_density integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='dim_source_diversity') THEN
    ALTER TABLE analyses ADD COLUMN dim_source_diversity integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='dim_framing_patterns') THEN
    ALTER TABLE analyses ADD COLUMN dim_framing_patterns integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='dim_host_credibility') THEN
    ALTER TABLE analyses ADD COLUMN dim_host_credibility integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='dim_omission_risk') THEN
    ALTER TABLE analyses ADD COLUMN dim_omission_risk integer;
  END IF;

  -- Community flywheel
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='analyze_count') THEN
    ALTER TABLE analyses ADD COLUMN analyze_count integer DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='last_analyzed_at') THEN
    ALTER TABLE analyses ADD COLUMN last_analyzed_at timestamptz DEFAULT now();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='analyzed_at') THEN
    ALTER TABLE analyses ADD COLUMN analyzed_at timestamptz DEFAULT now();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='analyses' AND column_name='created_at') THEN
    ALTER TABLE analyses ADD COLUMN created_at timestamptz DEFAULT now();
  END IF;

END $$;

-- Unique index on canonical_key for upsert deduplication
CREATE UNIQUE INDEX IF NOT EXISTS analyses_canonical_key_idx ON analyses(canonical_key)
  WHERE canonical_key IS NOT NULL;

-- Index on show_name for trend chart queries
CREATE INDEX IF NOT EXISTS analyses_show_name_idx ON analyses(show_name);

-- Index on user_id + analyzed_at for per-user history queries
CREATE INDEX IF NOT EXISTS analyses_user_id_analyzed_idx ON analyses(user_id, analyzed_at DESC);

-- Index on analyzed_at for platform-wide trending queries
CREATE INDEX IF NOT EXISTS analyses_analyzed_at_idx ON analyses(analyzed_at DESC);

-- ── followed_shows table — add missing columns ───────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='followed_shows' AND column_name='show_name') THEN
    ALTER TABLE followed_shows ADD COLUMN show_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='followed_shows' AND column_name='artwork') THEN
    ALTER TABLE followed_shows ADD COLUMN artwork text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='followed_shows' AND column_name='spotify_id') THEN
    ALTER TABLE followed_shows ADD COLUMN spotify_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='followed_shows' AND column_name='spotify_url') THEN
    ALTER TABLE followed_shows ADD COLUMN spotify_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='followed_shows' AND column_name='feed_url') THEN
    ALTER TABLE followed_shows ADD COLUMN feed_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='followed_shows' AND column_name='followed_at') THEN
    ALTER TABLE followed_shows ADD COLUMN followed_at timestamptz DEFAULT now();
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS followed_shows_user_show_idx
  ON followed_shows(user_id, show_name)
  WHERE show_name IS NOT NULL;

-- ── users table — add interests column ──────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='interests') THEN
    ALTER TABLE users ADD COLUMN interests text[];
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='podcast_url') THEN
    ALTER TABLE users ADD COLUMN podcast_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='tier') THEN
    ALTER TABLE users ADD COLUMN tier text DEFAULT 'free';
  END IF;
END $$;

-- RLS policies for analyses (users see own + all community data)
ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read all analyses" ON analyses;
CREATE POLICY "Users can read all analyses"
  ON analyses FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Service role can write analyses" ON analyses;
CREATE POLICY "Service role can write analyses"
  ON analyses FOR ALL
  USING (auth.role() = 'service_role');

SELECT 'Migration complete ✅' as status;
