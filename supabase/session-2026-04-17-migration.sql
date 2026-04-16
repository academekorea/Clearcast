-- ── 2026-04-17 session migration ─────────────────────────────────────────────
-- Adds the three columns this session's code writes that didn't exist in the
-- users table. All idempotent (IF NOT EXISTS) — safe to re-run.
--
-- Run this in Supabase SQL Editor:
--   https://suqjdctajnitxivczjtg.supabase.co → SQL Editor → New query → paste → Run

-- ── users.bio ───────────────────────────────────────────────────────────────
-- Written by /api/update-profile (Edit Name modal supports bio in payload).
-- Read by /api/get-user-profile (restored on cross-device login).
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT NULL;

-- ── users.avatar_custom_url ─────────────────────────────────────────────────
-- Written by /api/update-profile when user uploads a custom avatar
-- (data:image/ payload, capped at 500KB by the function).
-- Distinct from avatar_url which is the OAuth-provider avatar.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_custom_url TEXT DEFAULT NULL;

-- ── users.theme ─────────────────────────────────────────────────────────────
-- Written by /api/sync-user-data (frontend syncToServer('theme', ...)).
-- Read by /api/get-user-profile so dark/light preference follows the user
-- across devices.
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT NULL;

-- ── No new tables needed for this session. ──────────────────────────────────
-- Existing tables already cover everything else:
--   followed_shows.smart_queue          ← Smart Queue per-show toggle
--   users.smart_queue_enabled           ← Smart Queue user-level flag
--   users.region                         ← Region pill selection
--   users.email                          ← Email change endpoint
--   users.liked_episodes (JSONB)         ← Liked episodes sync
--   users.interests (text[])             ← Interests onboarding
--   analysis_queue                       ← Smart Queue cron writes here
--   notifications                        ← Smart Queue + episode alerts
