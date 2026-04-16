# PODLENS — Claude Code Master Reference
**Last updated: April 13, 2026 — v6.0**

## Project Identity
- **Name:** Podlens
- **Tagline:** "A force of clarity in the age of noise"
- **Mission:** World's first podcast bias intelligence platform. AI that tells you how to trust content, not just summarize it.
- **Live site:** https://podlens.app
- **GitHub:** https://github.com/academekorea/PODLENS
- **Netlify site ID:** 336b4d9b-fcc0-4675-a7d8-f61022fc2cdc
- **Supabase:** suqjdctajnitxivczjtg.supabase.co
- **Super admin:** academekorea@gmail.com (Studio tier, unlimited, bypass_limits=true)

## Stack
- **Frontend:** Vanilla JS SPA — single `index.html` (~13,400+ lines)
- **Functions:** Netlify Functions (.mts TypeScript)
- **Auth/DB:** Supabase (10 tables, RLS disabled)
- **Payments:** Stripe
- **Transcription:** AssemblyAI
- **Audio/TTS:** ElevenLabs (primary) → OpenAI tts-1-hd (fallback) → Web Speech API (emergency)
- **Analysis:** Claude Haiku (run-analysis) / Claude Sonnet 4 (status)
- **Audio extraction:** Railway yt-dlp service
- **Hosting:** Netlify (auto-deploy from main)

## Claude Code Rules — ALWAYS FOLLOW
- Scheduled functions: NO path in config, only schedule field
- Never declare same variable name twice in scope
- Always use `Netlify.env.get()` — never `process.env`
- All functions use `.mts` TypeScript format
- Background functions must have `-background` suffix
- Never use inline style overrides — define CSS classes instead
- Never use `!important` unless overriding `body.authenticated` state or inline JS styles
- **Always run `tsc --noEmit` before pushing any TypeScript changes — zero errors required**
- Never push until syntax check passes on all modified files
- Do not push until explicitly told to push

## Architecture — What Lives Where
- `index.html` — Full SPA. All views live here: home, discover, analyze, library, account, settings, show, admin, how-it-works, pricing
- `sidebar.js` — Single source of truth for left sidebar navigation
- `library-view.js` — Library panels (overview, following, analyzed, liked)
- `nav.js` — Top navbar, auth-aware, injects into #nav-links on all pages
- `js/utils.js` — Intelligence system: calcWeeklyBias, calcBiasFingerprint, calcEchoChamber, calcRecommendedLean, recordListenEvent, getListenHistory
- `netlify/functions/` — All backend logic
- `_redirects` — SPA catch-all: `/* /index.html 200`
- `netlify.toml` — Build config, function timeouts, redirects

## Key netlify.toml Rules
- `/pricing` → `/index.html` (NOT /pricing.html — file deleted)
- `/how-it-works` → `/index.html` (NOT /how-it-works.html — file deleted)
- `/api/*` → `/.netlify/functions/:splat`
- `/auth/spotify/callback` → `/.netlify/functions/spotify-callback`
- `/auth/google/callback` → `/.netlify/functions/google-callback`

## Deleted Files (DO NOT RECREATE)
- `pricing.html` — now `view-pricing` in index.html
- `how-it-works.html` — now `view-how-it-works` in index.html
- `library.html` — now `view-library` in index.html
- `account.html`, `profile.html`, `settings.html` — now SPA views in index.html

## SPA Navigation
- All navigation uses `showView(name)` — never href to internal pages
- `showHome()` is a thin wrapper: `function showHome() { showView('home'); }`
- `_viewFromPath(path)` maps URL pathnames to view names on initial load
- URL map: `/` → home, `/discover`, `/analyze`, `/library`, `/account`, `/settings`, `/how-it-works`, `/pricing`, `/show`, `/admin`

## Intelligence System (js/utils.js)
- **Tier 1 (listening):** weight 0.3, feeds fingerprint + echo chamber + weekly bias
- **Tier 2 (analysis):** weight 1.0, feeds all Tier 1 + deep intelligence
- **Duration factor:** `min(1.0, max(0.1, durationMinutes/60))` applied to both weights
- **Fingerprint:** weekly-normalized exponential decay, DECAY_FACTOR=0.85
- **Activation threshold:** 10+ combined signals OR 7+ days of data
- **Recommended lean:** anti-echo-chamber, surfaces opposite lean when >25 point imbalance
- All functions exported on `window` object

## Pricing Tiers
- **Free:** 4 analyses/month
- **Starter Lens ($7/mo):** 25 analyses, pre-analysis tracking 3 shows
- **Pro Lens ($19/mo):** Unlimited analyses, pre-analysis tracking 5 shows
- **Operator Lens ($49/mo):** Unlimited + teams + delivery analysis (Hume AI) + bulk

## Plan Enforcement in Code
- Plan names in code: `free`, `creator` (=Starter Lens), `operator` (=Pro Lens), `studio` (=Operator Lens)
- Pre-analysis tracking limits: creator=3, operator=5, studio=unlimited
- Smart Queue: creator, operator, studio, trial only (not free)

## Key Function Paths
- `/api/analyze` — job creation, quota check, cache lookup
- `/api/status` — polls AssemblyAI, calls Claude, writes Supabase
- `/api/run-analysis` — full analysis (haiku), webhook from AssemblyAI
- `/api/save-interests` — writes user topic preferences to Supabase users.interests
- `/api/get-spotify-token` — reads Spotify access token from Supabase connected_accounts
- `/api/for-you` — personalized Discover feed based on interests + analysis history
- `/api/og-image` — dynamic OG share card (1200×630 PNG/SVG) per jobId
- `/embed/show/{slug}` — embeddable bias widget (iframe-ready HTML)
- `/auth/spotify/callback` — Spotify OAuth, redirects to /?spotify=connected
- `/auth/google/callback` — Google OAuth, user upsert to Supabase

## Supabase Tables
`users`, `analyses`, `subscriptions`, `events`, `connected_accounts`, `followed_shows`, `analysis_queue`, `shows`, `usage`, `notifications`

New columns added April 2026:
- `users.interests` (jsonb), `users.interests_updated_at`, `users.voice_preference`
- `analyses.host_count`, `analyses.has_guest`, `analyses.guest_score`, `analyses.episode_number`, `analyses.host_names`, `analyses.duration_minutes`

## Netlify Blobs Namespaces
- `podlens-jobs/{jobId}` — analysis jobs
- `podlens-jobs/canon:{canonical}` — community cache (permanent)
- `podlens-jobs/brief:{canonical}` — audio brief cache
- `podlens-users/youtube-{userId}` — Google OAuth tokens
- `podlens-users/spotify-{userId}` — Spotify OAuth tokens
- `podlens-cache/show-meta-{slug}` — show profiles
- `podlens-cache/show-meta-youtube-{channelSlug}` — YouTube-only show profiles

## Current Active Issues (April 16, 2026)
1. ~~**netlify.toml broken redirects**~~ — RESOLVED. /pricing and /how-it-works now route to /index.html
2. ~~**Spotify import broken**~~ — RESOLVED. startSpotifyImport() exists, OAuth flow intact
3. ~~**Analysis not registering**~~ — RESOLVED. trackAnalysis() fully implemented with Library refresh
4. ~~**Social share reverted**~~ — RESOLVED. shareAnalysis() + showShareModal() fully functional
5. **Google OAuth unverified app warning** — Google Console needs: publish app to production (scopes are non-sensitive, no review required). Consent screen must have privacy/terms URLs and podlens.app as authorized domain.
6. **CURRENTS_API_KEY not set on Netlify** — Trending news pills currently serve the static fallback list. Grab a key from currentsapi.services and add it as CURRENTS_API_KEY in Netlify environment variables (Site config → Environment variables). Once set, pills go fully live with real news topics. Not a bug — just a missing env var.

## CLAUDE.md Update Instructions
When significant architecture, features, or decisions change, update this file to reflect current state. Version and date at top. Keep sections current — stale info causes Claude Code to make wrong decisions.
