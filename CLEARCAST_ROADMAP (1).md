# Clearcast — Master Roadmap
*Last updated: April 2026*

---

## What Clearcast Is
Podcast bias intelligence platform — Ground News for audio.
Users paste any podcast URL and get AI-powered analysis: bias score, audio lean bar,
factuality rating, host trust score, topic breakdown, key quotes, missing voices, sponsor conflicts.

**Live URL:** https://clearcast-app.netlify.app
**GitHub:** https://github.com/academekorea/Clearcast (private)
**Netlify Site ID:** 336b4d9b-fcc0-4675-a7d8-f61022fc2cdc

---

## Tech Stack
- **Frontend:** Single index.html (vanilla JS, no framework)
- **Backend:** Netlify serverless functions (TypeScript .mts)
- **Storage:** Netlify Blobs (migrate to Supabase in Phase 2)
- **Transcription:** AssemblyAI v2 (speech_model: "best")
- **Analysis:** Claude API (claude-sonnet-4-20250514)
- **Podcast data:** YouTube Data API v3 + curated fallback shows
- **Deploy:** GitHub to Netlify auto-deploy on every push to main

---

## Environment Variables
| Key | Purpose | Status |
|-----|---------|--------|
| ANTHROPIC_API_KEY | Claude analysis | Set |
| ASSEMBLYAI_API_KEY | Transcription | Set |
| YOUTUBE_API_KEY | YouTube search | Needs adding |

---

## Deployed Functions
| File | Route | Purpose |
|------|-------|---------|
| analyze.mts | POST /api/analyze | Submit audio/YouTube URL |
| status.mts | GET /api/status/:jobId | Poll + run Claude analysis |
| stories.mts | GET /api/stories?q= | Search YouTube for episodes |
| marketplace.mts | GET /api/marketplace?genre= | Browse top shows |
| episodes.mts | GET /api/episodes?url= | Parse RSS feed |
| blindspot.mts | GET /api/blindspot | Unheard report data |
| show-profile.mts | GET /api/show-profile?id= | Show intelligence profile |

---

## Workflow
| Task | Tool |
|------|------|
| Code, bug fixes, features | Claude Code (Terminal) |
| Database, auth, payments | Netlify Extensions |
| Strategy, decisions | Claude.ai chat |
| Deploy | Automatic via GitHub to Netlify |

---

# PHASE 1 — Foundation & Core Intelligence
**Goal:** Stable product with unique intelligence features. Ship before anyone notices the space.
**Timeline:** Now — Month 1

## Bug Fixes (priority order)
- [ ] Trending topic chips — fetchStories returns empty on chip click
- [ ] Tab panel overlap — multiple panels visible simultaneously
- [ ] Mobile layout — sidebar collapses with no replacement UI
- [x] YouTube URL analysis — now passes directly to AssemblyAI

## Core Features
- [x] Analysis pipeline (AssemblyAI to Claude to results)
- [x] Audio lean bar (real transcript data, never fake)
- [x] Side-by-side YouTube player + analysis panel
- [x] Curated fallback shows (homepage never blank)
- [x] Unheard Pro gate
- [x] Upgrade modal with pricing
- [ ] YouTube Data API replacing iTunes
- [ ] Show Profile pages (full spec below)
- [ ] Pre-analyze 50-100 episodes before launch
- [ ] Dispute button on analysis results
- [ ] Public methodology page

## Show Profile Pages
**Route:** /show/[show-slug]
**Trigger:** Click any show name or artwork anywhere on site

### Header
- Show artwork, name, host, category
- Overall bias label and average score across all analyzed episodes
- Aggregate audio lean bar
- Analyze a new episode CTA

### Clearcast Intelligence Metrics
| Metric | What it measures | Free/Pro |
|--------|-----------------|----------|
| Consistency Score 0-100 | How stable bias is episode to episode | Free |
| Audio Lean Distribution | Aggregate left/center/right % | Free |
| Host Influence Index | Average parasocial language score | Pro |
| Factuality Track Record | % episodes factual/mixed/unreliable | Pro |
| Missing Voices Pattern | Perspectives consistently absent | Pro |
| Sponsor Conflict Rate | % episodes with sponsor conflicts | Pro |
| Topic Lean Map | Which topics lean which direction | Pro |
| Bias Drift | Bias score over time line chart | Pro |

### Episode List
- All episodes Clearcast users have analyzed for this show
- Each row: title, date, bias score, factuality, audio lean bar
- Click any row to see full analysis
- Empty state: "Be the first to analyze an episode from this show"

### Backend
- New function: show-profile.mts at /api/show-profile?id=[showId]
- Aggregates all Netlify Blobs analyses matching show ID
- Show ID = slugified show name

## Anti-Failure Features Built Into Phase 1
- Show reasoning not just scores — basis sentence always visible under audio lean bar
- Dispute this analysis button — user flags disagreement
- Public methodology page — how Claude detects bias
- X users analyzed this show counter on show profiles
- Partial results loading — bias score first, then flags, then quotes
- Analysis caching — popular episodes never re-analyze

---

# PHASE 2 — Monetization & Growth
**Goal:** First 100 paying users
**Timeline:** Month 1-2

## Payments and Auth
- [ ] Supabase via Netlify Extensions
  - User accounts (email + Google login)
  - Save analyzed episodes per user
  - Track free tier usage (hard cap 2/week)
  - Personal bias fingerprint
- [ ] Stripe Pro subscriptions
  - $5/month or $40/year
  - 7-day free trial
  - Paywall triggers after 2nd free analysis

## Free vs Pro
| Feature | Free | Pro |
|---------|------|-----|
| Browse marketplace | Yes | Yes |
| Analyses per week | 2 | Unlimited |
| Bias score + audio lean | Yes | Yes |
| Show profile basic | Yes | Yes |
| Full analysis quotes and flags | No | Yes |
| Host influence index | No | Yes |
| Factuality track record | No | Yes |
| Missing voices pattern | No | Yes |
| Sponsor conflict rate | No | Yes |
| Bias drift chart | No | Yes |
| Unheard weekly report | No | Yes |
| Personal bias fingerprint | No | Yes |
| Analysis history | No | Yes |
| Priority queue | No | Yes |

## GTM
- [ ] Pre-analyze 50-100 popular episodes before launch
- [ ] Product Hunt launch
- [ ] Reddit: r/podcasts, r/MediaLiteracy, r/GroundNews
- [ ] Viral launch: analyze controversial episode, post results on Twitter
- [ ] Media literacy educators (Poynter, journalism schools)
- [ ] One sentence pitch everywhere: "Like Ground News, but for podcasts"
- [ ] Show a completed analysis on the homepage

## Infrastructure
- [ ] Migrate Netlify Blobs to Supabase
- [ ] Hard rate limit on free tier
- [ ] Shareable analysis cards for social

---

# PHASE 3 — Chrome Extension
**Goal:** Meet users where they already are. Solve the speed problem.
**Timeline:** Month 2-3

## What it does
- Detects YouTube and Spotify podcast pages
- Injects Clearcast panel into page sidebar
- Sends URL to /api/analyze automatically
- Shows bias score, audio lean bar, flags without leaving the page
- Analysis runs in background while user watches — no waiting

## Files needed
- manifest.json
- content.js (reads page URL, injects panel)
- background.js (service worker, calls Clearcast API)
- popup.html and popup.js
- styles.css

## Distribution
1. Test as unpacked extension (chrome://extensions)
2. Submit to Chrome Web Store ($5 one-time fee)
3. Review: 1-3 business days

---

# PHASE 4 — Korean Market
**Goal:** First non-English market, zero competition
**Timeline:** Month 3-4

- [ ] Korean YouTube search
- [ ] Korean trending topics in topic strip
- [ ] Korean-language Claude analysis prompt
- [ ] Korean show database (top 50 Korean podcasts)
- [ ] Korean UI (proper i18n)
- [ ] Korean GTM: Podbbang community, Korean media Twitter

---

# PHASE 5 — Scale
**Goal:** $10K MRR
**Timeline:** Month 4-6

- [ ] Clearcast Verified badge for podcasters
- [ ] Embed widget for podcast sites
- [ ] API access for journalism schools
- [ ] Timestamped bias markers in audio player
- [ ] Show comparison (two shows, same topic)
- [ ] Mobile app (React Native)

---

# Pre-Mortem — Why Clearcast Could Fail & Prevention

## Failure 1 — Analysis not trusted
**Risk:** User disagrees with score, posts negatively, goes viral in wrong direction.
**Prevention:**
- Always show reasoning not just numbers (basis sentence under every bar)
- Never say "this show IS biased" — say "here's what we detected"
- Dispute button — transparency builds trust
- Publish methodology publicly

## Failure 2 — Data too thin
**Risk:** Show profiles all show "No episodes analyzed yet." Ghost town. Users leave.
**Prevention:**
- Pre-analyze 50-100 episodes before launch
- "X Clearcast users analyzed this show" counter
- Incentivize: free Pro week for users who analyze 5 episodes

## Failure 3 — Too slow to be useful
**Risk:** 4-minute wait kills retention. Users give up.
**Prevention:**
- Chrome extension runs analysis in background while user watches
- Show partial results as they arrive (score first)
- Cache — second user to analyze same episode gets instant results
- Set expectations upfront ("Full episode takes 3-4 min")

## Failure 4 — Nobody understands what it does
**Risk:** Abstract pitch loses people. No word of mouth.
**Prevention:**
- Lead with output: "Find out if your favorite podcast is telling you the whole story"
- One sentence: "Like Ground News, but for podcasts"
- Show completed analysis on homepage — product explains itself
- Viral launch with controversial episode analysis

## Failure 5 — Business model doesn't work
**Risk:** Free tier too generous, no conversion, API costs exceed revenue.
**Prevention:**
- Hard cap: 2 analyses/week maximum on free
- Paywall is specific: "You've seen the score. Pro shows you why — the exact quotes, the missing voices, the sponsor conflicts"
- Show profile is primary conversion mechanism
- Every free analysis costs ~$0.15 in API fees — hard cap is essential

## Failure 6 — Bigger player copies it
**Risk:** Spotify or Ground News adds podcast bias analysis.
**Prevention:**
- Data moat: 100,000 analyses = proprietary database nobody replicates fast
- Community moat: users invested in history and show profiles don't switch
- Extension moat: Clearcast becomes the layer on top of every platform
- Be first and be loud

## The One Failure That Kills Everything
Running out of money and motivation before critical mass.

**90-day target:** 100 paying users or a clear signal they're coming.
If not, the market is speaking. If yes, proof of concept secured.

---

# ICP

**Primary:** Skeptical news consumer, 28-45, already uses Ground News,
3-5 podcasts/week, pays for Spotify and NYT, cares about being manipulated.

**Secondary:** Heavy listener, 7+ hours/week, senses bias but can't quantify it.

**Korean:** University-educated 25-40, aware of Korean media polarization, early adopter.

**One sentence:** Someone who already pays for Ground News and wishes it worked for podcasts.

---

# Revenue Targets
| Users | MRR |
|-------|-----|
| 100 | $500 |
| 500 | $2,500 |
| 2,000 | $10,000 |
| 10,000 | $50,000 — first hire threshold |

**No ads. Ever.** Conflicts with bias-detection credibility.

---

# Key Links
| Resource | URL |
|----------|-----|
| Live site | https://clearcast-app.netlify.app |
| Netlify | https://app.netlify.com/projects/clearcast-app |
| GitHub | https://github.com/academekorea/Clearcast |
| AssemblyAI | https://www.assemblyai.com/dashboard |
| Anthropic | https://console.anthropic.com |
| Google Cloud | https://console.cloud.google.com |
| Supabase | https://supabase.com |
| Stripe | https://dashboard.stripe.com |
