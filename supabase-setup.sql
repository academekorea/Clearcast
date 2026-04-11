-- ── PodLens Complete Database Setup ──────────────────────────────────────────
-- Run this in Supabase → SQL Editor
-- Creates all tables with correct schemas from scratch (safe — uses IF NOT EXISTS)

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY,
  email         text UNIQUE,
  name          text,
  avatar_url    text,
  provider      text DEFAULT 'google',
  plan          text DEFAULT 'free',
  tier          text DEFAULT 'free',
  stripe_customer_id    text,
  stripe_subscription_id text,
  is_super_admin        boolean DEFAULT false,
  founding_member       boolean DEFAULT false,
  founding_member_since text,
  founding_signup_number integer,
  pilot_member          boolean DEFAULT false,
  pilot_expires_at      text,
  interests     text[],
  podcast_url   text,
  smart_queue_enabled boolean DEFAULT false,
  region        text,
  language      text,
  last_seen_at  timestamptz DEFAULT now(),
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- ── analyses ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analyses (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id          text UNIQUE,
  canonical_key   text UNIQUE,
  url             text,
  episode_title   text,
  show_name       text,
  source_url      text,
  user_id         text REFERENCES users(id) ON DELETE SET NULL,
  bias_score      integer,
  bias_label      text,
  bias_direction  text,
  factuality_label text,
  omission_risk   text,
  summary         text,
  bias_reason     text,
  host_trust_score integer,
  unheard_summary text,
  dim_perspective_balance integer,
  dim_factual_density     integer,
  dim_source_diversity    integer,
  dim_framing_patterns    integer,
  dim_host_credibility    integer,
  dim_omission_risk       integer,
  analyze_count   integer DEFAULT 1,
  analyzed_at     timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now()
);

-- ── subscriptions ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         text REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id     text,
  stripe_subscription_id text UNIQUE,
  plan            text,
  billing_period  text DEFAULT 'month',
  status          text DEFAULT 'active',
  amount          integer DEFAULT 0,
  founding_discount boolean DEFAULT false,
  current_period_start timestamptz,
  current_period_end   timestamptz,
  canceled_at     timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- ── events ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     text REFERENCES users(id) ON DELETE SET NULL,
  event_type  text,
  type        text,
  metadata    jsonb DEFAULT '{}',
  properties  jsonb DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);

-- ── connected_accounts ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS connected_accounts (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         text REFERENCES users(id) ON DELETE CASCADE,
  provider        text,
  access_token    text,
  refresh_token   text,
  expires_at      timestamptz,
  provider_user_id text,
  provider_username text,
  provider_email  text,
  metadata        jsonb DEFAULT '{}',
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE(user_id, provider)
);

-- ── followed_shows ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS followed_shows (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     text REFERENCES users(id) ON DELETE CASCADE,
  show_name   text,
  feed_url    text,
  artwork_url text,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(user_id, feed_url)
);

-- ── analysis_queue ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analysis_queue (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id      text UNIQUE,
  url         text,
  show_name   text,
  episode_title text,
  status      text DEFAULT 'pending',
  priority    integer DEFAULT 5,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- ── shows ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shows (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  feed_url    text UNIQUE,
  show_name   text,
  artwork_url text,
  bias_score  integer,
  bias_label  text,
  episode_count integer DEFAULT 0,
  last_analyzed_at timestamptz,
  created_at  timestamptz DEFAULT now()
);

-- ── usage ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usage (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     text REFERENCES users(id) ON DELETE CASCADE,
  month       text,
  analyses_count integer DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(user_id, month)
);

-- ── notifications ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     text REFERENCES users(id) ON DELETE CASCADE,
  type        text,
  title       text,
  body        text,
  read        boolean DEFAULT false,
  created_at  timestamptz DEFAULT now()
);

-- ── Disable RLS on all tables (service key writes bypass anyway) ──────────────
ALTER TABLE users              DISABLE ROW LEVEL SECURITY;
ALTER TABLE analyses           DISABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions      DISABLE ROW LEVEL SECURITY;
ALTER TABLE events             DISABLE ROW LEVEL SECURITY;
ALTER TABLE connected_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE followed_shows     DISABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_queue     DISABLE ROW LEVEL SECURITY;
ALTER TABLE shows              DISABLE ROW LEVEL SECURITY;
ALTER TABLE usage              DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications      DISABLE ROW LEVEL SECURITY;

-- ── Indexes for common queries ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_analyses_canonical_key ON analyses(canonical_key);
CREATE INDEX IF NOT EXISTS idx_analyses_user_id ON analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_analyses_show_name ON analyses(show_name);
CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

SELECT 'PodLens database setup complete ✅' as status;
