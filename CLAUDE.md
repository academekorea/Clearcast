# PODLENS — Claude Code Master Reference

## Project Identity
- **Name:** Podlens
- **Tagline:** "Know what you're actually listening to"
- **Type:** Podcast bias intelligence platform — Ground News for audio
- **Live URL:** https://podlens.app (password: lens2026 while building)
- **Netlify subdomain:** https://podlens.netlify.app
- **Netlify project:** podlens
- **Netlify site ID:** 336b4d9b-fcc0-4675-a7d8-f61022fc2cdc
- **GitHub:** https://github.com/academekorea/podlens (private)
- **Project folder:** ~/Desktop/podlens/
- **Extension folder:** ~/Desktop/podlens-extension/ (separate repo)
- **Contact:** hello@podlens.app

---

## CRITICAL TONE — Apply to Every Line of UI Copy

Podlens is a **GUIDE not a JUDGE**.

| NEVER say | ALWAYS say |
|---|---|
| "This podcast is biased" | "This podcast leans [direction]" |
| "This host is untrustworthy" | "This host scores X on trust" |
| "You should listen to something else" | "Here's what you might be missing" |
| "Your listening is one-sided" | "Here's your listening fingerprint" |
| "This episode promotes misinformation" | "This episode contains unverified claims" |

Users should feel **smarter, not judged**. Every insight is a gift, not a verdict.
Apply this tone to: results, errors, upgrade prompts, empty states, onboarding, everything.

---

## Tech Stack

| Component | Technology |
|---|---|
| Frontend | Single index.html (vanilla JS — no framework) |
| Backend | Netlify serverless functions (TypeScript .mts) |
| Edge Functions | netlify/edge-functions/ (geo/language detection) |
| Storage | Netlify Blobs (→ Supabase Phase 3) |
| AI Analysis | Claude API (claude-sonnet-4-20250514) |
| Transcription | AssemblyAI v2 (speech_models: ["universal-3-pro"]) |
| Podcast data | YouTube Data API + iTunes/Apple Podcasts API |
| Audio fallback | Railway yt-dlp service (AUDIO_SERVICE_URL) |
| Payments | Stripe (live mode — subscription billing) |
| Auth | Netlify Identity (→ Supabase Phase 3) |
| Deploy | GitHub → Netlify auto-deploy on main branch push |
| Domain | podlens.app (Namecheap → Netlify DNS) |

---

## Environment Variables — All Set in Netlify

| Variable | Status | Purpose |
|---|---|---|
| ANTHROPIC_API_KEY | ✅ Set | Claude AI analysis |
| ASSEMBLYAI_API_KEY | ✅ Set | Audio transcription |
| YOUTUBE_API_KEY | ✅ Set | YouTube metadata + captions |
| AUDIO_SERVICE_URL | ✅ Set | https://podlens-audio-service-production.up.railway.app |
| SPOTIFY_CLIENT_ID | ✅ Set | 1eb72bc291654bfba6cd9ce1679c5774 |
| SPOTIFY_CLIENT_SECRET | ✅ Set | Spotify API auth |
| STRIPE_PUBLISHABLE_KEY | ✅ Set (live) | pk_live_51TIboFR... |
| STRIPE_SECRET_KEY | ✅ Set (live) | sk_live_51TIboFR... |
| STRIPE_WEBHOOK_SECRET | ⏳ Pending | Add after webhook setup in Stripe dashboard |
| STRIPE_CREATOR_MONTHLY_ID | ⏳ Pending | $12/mo price ID (price_live_...) |
| STRIPE_CREATOR_ANNUAL_ID | ⏳ Pending | $99/yr price ID |
| STRIPE_OPERATOR_MONTHLY_ID | ⏳ Pending | $39/mo price ID |
| STRIPE_OPERATOR_ANNUAL_ID | ⏳ Pending | $299/yr price ID |
| STRIPE_STUDIO_MONTHLY_ID | ⏳ Pending | $99/mo price ID |
| STRIPE_STUDIO_ANNUAL_ID | ⏳ Pending | $799/yr price ID |
| GOOGLE_CLIENT_ID | ⏳ Pending | console.cloud.google.com |
| GOOGLE_CLIENT_SECRET | ⏳ Pending | Google OAuth backend |
| KAKAO_APP_KEY | ⏳ Pending | developers.kakao.com (Korean market) |

---

## Pricing — 4 Tiers (NO OLD $5/mo ANYWHERE)

Each tier = a real use case, not a feature list.

### LISTENER — Free — "Is this worth my time?"
- Browse pre-analyzed content (bias labels visible, scores blurred)
- 3 analyses per week after trial
- Plain English bias label ALWAYS visible (the hook — never blur this)
- Shows followed (read-only feed)
- Profile + history stays forever

### CREATOR — $12/mo or $99/yr — "What is my listening doing to me?"
- Unlimited quick analyses (~30 seconds)
- Audio briefing player (90-second spoken summary)
- Personal bias fingerprint (updating)
- Full bias scores visible
- Shareable bias cards
- Download Basic PDF report
- Transcript highlights (top 10 quotes)
- Analysis history (full)

### OPERATOR — $39/mo or $299/yr — "What am I missing?" ★ MOST POPULAR
- Everything in Creator
- Unlimited deep analyses (2-5 min full transcript)
- Source citations (exact quotes proving each finding)
- Missing voices (full detail + suggestions)
- Sponsor conflict detection (full detail)
- Unheard weekly report
- Show comparison (unlimited)
- Chrome extension access
- Full bias fingerprint with category breakdown + trends
- Download Full PDF report
- Full searchable transcript
- Timestamp markers in player with citations

### STUDIO — $99/mo or $799/yr — "What is our organization missing?"
- Everything in Operator
- Bulk/batch episode scanning
- API access
- White-label reports
- CSV export of all analyses
- Priority support

---

## 7-Day Trial System

Every signup gets 7 days of Operator access minus 4 features:
- ❌ Audio briefings (Creator+)
- ❌ Source citations (Operator+)
- ❌ Deep analysis (Operator+)
- ❌ Chrome extension (Operator+)

After 7 days → Free tier. Profile + history + fingerprint stay FOREVER.

### User Object (localStorage: key 'podlens_user')
```javascript
{
  id: crypto.randomUUID(),
  email: string,
  name: string,
  signupDate: new Date().toISOString(),
  plan: "trial", // "trial"|"free"|"creator"|"operator"|"studio"
  trialEndsAt: new Date(Date.now() + 7*24*60*60*1000).toISOString(),
  analysesThisWeek: 0,
  weekResetDate: new Date(Date.now() + 7*24*60*60*1000).toISOString(),
  analyzedEpisodes: [],
  followedShows: [],
  biasFingerprint: { leftPct:0, centerPct:0, rightPct:0, totalEpisodes:0 },
  preferredCategories: [],
  monthlyReports: []
}
```

### Plan Enforcement — Run Every Page Load
```javascript
function getUserPlan() {
  const user = JSON.parse(localStorage.getItem('podlens_user') || '{}');
  const plan = user.plan || 'free';
  if (plan === 'trial' && new Date() > new Date(user.trialEndsAt)) {
    user.plan = 'free';
    localStorage.setItem('podlens_user', JSON.stringify(user));
    return 'free';
  }
  if (plan === 'free' && new Date() > new Date(user.weekResetDate)) {
    user.analysesThisWeek = 0;
    user.weekResetDate = new Date(Date.now()+7*24*60*60*1000).toISOString();
    localStorage.setItem('podlens_user', JSON.stringify(user));
  }
  return plan;
}

function canAccess(feature) {
  const plan = getUserPlan();
  const tiers = {
    audioBriefing:       ['creator','operator','studio'],
    fullBiasScores:      ['creator','operator','studio'],
    biasFingerprint:     ['creator','operator','studio'],
    shareCards:          ['creator','operator','studio'],
    downloadBasic:       ['creator','operator','studio'],
    transcriptTop10:     ['creator','operator','studio'],
    sourceCitations:     ['operator','studio'],
    missingVoicesDetail: ['operator','studio'],
    deepAnalysis:        ['operator','studio'],
    unheard:             ['operator','studio'],
    showComparison:      ['operator','studio'],
    extension:           ['operator','studio'],
    fullTranscript:      ['operator','studio'],
    downloadFull:        ['operator','studio'],
    timestampMarkers:    ['operator','studio'],
    csvExport:           ['studio'],
    bulkScan:            ['studio'],
    apiAccess:           ['studio'],
  };
  return tiers[feature]?.includes(plan) || false;
}
```

**RULE: Call canAccess() BEFORE fetching any gated data.**
**NEVER fetch data then hide with CSS — always gate server-side first.**

---

## Bias Meter Design — REMOVE ALL -100/+100 REFERENCES

```
1. Bar: Red(#E24B4A) | Gray(#D1CFC9) | Blue(#378ADD)
   Height 12px, fully rounded, proportional to percentages

2. Labels: 🔴 X% left  ⬜ X% center  🔵 X% right (Inter 13px)

3. Plain English label pill:
   abs(leftPct - rightPct) < 20  → "Mostly balanced"     (green)
   20-39                         → "Lightly one-sided"    (amber)
   40-59                         → "Moderately biased"    (amber)
   60-79                         → "Heavily one-sided"    (red)
   80+                           → "Extremely one-sided"  (red)

4. Section heading: "Political Lean — how this episode frames issues"
   NEVER "Audio Lean"

5. Footnote: "Based on language patterns and framing choices
   — not a judgment of the host's personal politics" (12px italic muted)
```

**Plain English label is ALWAYS visible to ALL users including anonymous.**
Full percentages are blurred for Free tier. The label is the hook.

---

## Global Layout Rules

- Max content width: **1400px centered**
- Full width padding: **80px desktop, 24px mobile**
- Analysis results: **ALWAYS 2 columns** — LEFT 58% / RIGHT 42%
- Use **CSS Grid** for all major layouts
- Target: entire analysis visible without scrolling on 1440px
- Cards: **3-4 columns desktop, 2 tablet, 1 mobile**
- NO narrow center columns wasting horizontal space

### Analysis Page 2-Column Layout
```
LEFT COLUMN (58%):           RIGHT COLUMN (42%, sticky):
─────────────────────        ─────────────────────────────
Audio briefing player        Topic breakdown (full names)
Political lean bar           Missing voices + suggestions
Findings grid (2×2)          Episode info + platform links
Key quotes section           Share this analysis
```

---

## Progressive Loading — CRITICAL UX

2-5 minutes of blank loading kills retention. Deliver value in stages:

```
0-3 seconds:    iTunes metadata immediately (artwork, show, host)
                "Previously analyzed" cards from same show
                Live analysis feed starts (steps appear as complete)

30-60 seconds:  Topic bars animate in one by one (right column first)

45-90 seconds:  Bias bar fills left to right animation (1 second)

60-90 seconds:  ▶ AUDIO BRIEFING READY notification appears
                "Listen while the full analysis finishes loading"
                User listens — solves the waiting problem entirely

60-120 seconds: Finding cards fade in one by one (300ms between)

Complete:       Citations activate, download/share buttons appear
                Toast: "✅ Analysis complete"
```

**While waiting, show related content:**
- Previously analyzed episodes from same show (3 cards)
- Similar shows with bias scores (3 cards)
- Rotating insight cards (auto-advance 8 seconds)

**Estimated time display:**
```
< 30 min episode: "~1 minute"    2-3 hour: "~3 minutes"
30-60 min:        "~1.5 minutes" 3+ hour:  "~4-5 minutes"
1-2 hour:         "~2 minutes"
```

**Analysis caching (critical):**
- Check Netlify Blobs key `"analysis-" + hash(episodeUrl)` before starting
- If cached → return instantly, show "From Podlens database" badge
- Cache all analyses for 30 days
- Popular shows return in < 1 second as database grows

---

## YouTube → RSS Fallback (CRITICAL — Never Show Dead End)

```
LAYER 1: YouTube auto-captions → if fail:
LAYER 2: iTunes similarity match → RSS feed
  - Extract channel name from YouTube URL via YouTube Data API
  - Search iTunes with channel name
  - If similarity > 0.5 AND feedUrl exists:
    → Return { status:'needs_episode_selection', feedUrl, showName }
    → Frontend shows episode picker (NOT an error)
    → Show: "Found [Show Name] — select an episode"
LAYER 3: Podcastindex.org search → RSS feed
LAYER 4: Smart search UI (last resort — search bar, NOT RSS input)
  - Pre-filled with channel name, auto-searches iTunes
  - "Advanced options" collapsed section has RSS/MP3 for power users
```

**Frontend rule:** NEVER show an error state if fallback finds a match.
Show episode picker seamlessly as if user pasted RSS directly.

---

## Transcript Section Fix

**Old behavior:** Empty or showing raw transcript (wrong)
**New behavior:** Two states

**During analysis → "LIVE ANALYSIS FEED":**
```
🔍 Extracting transcript...     → ✅ 2,847 words extracted
📊 Identifying topics...        → ✅ 8 topics identified
⚖️ Analyzing framing patterns...→ ✅ 70% right-leaning detected
👤 Evaluating host trust...     → ✅ Host trust: 71/100
🔎 Detecting missing voices...  → ✅ 3 absent perspectives
✍️ Generating audio briefing... → ✅ Ready to play
```

**After analysis → "TRANSCRIPT HIGHLIGHTS":**
- Top 10 significant quotes with timestamps
- Color-coded left border: red/blue/gray
- Search input: "Search transcript highlights..."
- Gate: Free/Creator = top 10, Operator+ = full searchable

---

## Topic Breakdown Display Rules

Apply everywhere topics appear:
- **NEVER truncate names** with "..." — always show full name
- If name > 30 chars: wrap to 2 lines
- Bars: proportional (highest topic = 100% width, navy fill)
- Percentages right-aligned
- Sort descending
- Show top 8, "Show all X topics" toggle if more
- Hover: tooltip "This topic appeared in X% of content"

---

## Netlify Functions

| Endpoint | Purpose |
|---|---|
| /api/analyze | Start analysis job |
| /api/status/[jobId] | Poll progress + step updates |
| /api/find-episode | Find Spotify episode ID |
| /api/spotify-import | Import Spotify library |
| /api/spotify-callback | Spotify OAuth callback |
| /api/create-checkout | Stripe checkout session |
| /api/stripe-webhook | Handle Stripe events |
| /api/get-plan | Sync user plan from Blobs |
| /api/billing-portal | Stripe customer portal |
| /api/kakao-callback | KakaoTalk OAuth (Korean) |

---

## Platform Deep Linking

```javascript
// Auto-call /api/find-episode after analysis
// POST { showName, episodeTitle }
// Returns { found, spotifyUri, spotifyUrl }

[▶ Open in Spotify]  → Mobile: spotify:// | Desktop: open.spotify.com
[▶ Open in YouTube]  → Only if YouTube source
[▶ Apple Podcasts]   → iTunes collectionViewUrl or search
```

---

## Embedded Players

**YouTube:** iframe embed with custom scrubber + bias marker dots
**RSS/MP3:** Custom HTML5 player with same bias dots
**Dots:** Red=right-lean, Blue=left-lean, Gray=missing context
**Click dot:** Seeks to that timestamp
**Gate:** Dots visible all tiers, citation tooltips = Operator+

---

## Shareable Cards (HTML Canvas API)

- Square (1080×1080): Twitter, Instagram, Threads
- Story (1080×1920): Instagram Stories, Snapchat
- Topic card (1080×1080): Top 5 topics with bars
- All: #0f2027 navy background, circular artwork, bias bar
- Korean users: KakaoTalk share button (yellow #FEE500)

---

## Internationalization

**International English = default. Everything auto-detects.**

```javascript
// Priority: localStorage → edge cookie → browser lang → INTL/en/USD
const prices = {
  USD: { creator:"$12", operator:"$39", studio:"$99" },
  GBP: { creator:"£10", operator:"£32", studio:"£82" },
  EUR: { creator:"€11", operator:"€36", studio:"€92" },
  AUD: { creator:"A$18", operator:"A$59", studio:"A$149" },
  CAD: { creator:"C$16", operator:"C$52", studio:"C$132" },
  KRW: { creator:"₩16,000", operator:"₩52,000", studio:"₩135,000" }
};
```

---

## Korean Market — Simultaneous Beta Launch

Launches same time as international as a BETA feature.
Same URL (podlens.app), auto-detected from IP/language.
"베타" badge shown in Korean UI.

**Korean political framework:**
- 보수 (conservative): security, pro-US, free market, traditional values
- 중립 (center): balanced, evidence-based
- 진보 (progressive): welfare, labor, chaebol reform, North Korea dialogue

**Korean sources:**
```javascript
// Podbbang RSS
if (url.includes('podbbang.com/channels/'))
  rssUrl = `https://www.podbbang.com/channels/${id}/rss`;
// Naver Podcast RSS
if (url.includes('audioclip.naver.com/channels/'))
  rssUrl = `https://audioclip.naver.com/channels/${id}/rss.xml`;
```

**KakaoTalk (Korean users only):**
- Share button: yellow #FEE500
- Login button: KakaoTalk OAuth
- SDK: developers.kakao.com/sdk/js/kakao.js

---

## Chrome Extension

**Location:** ~/Desktop/podlens-extension/ — SEPARATE git repo
**NOT inside ~/Desktop/podlens/**

Supports: youtube.com/watch pages + open.spotify.com/episode pages
Sidebar auto-injects with: bias bar, findings, "See full analysis →"
Also handles YouTube→RSS fallback: shows "Select episode on Podlens →"

---

## Upgrade Triggers (contextual, never blocking)

```
1. Free hits 3rd analysis/week → non-blocking bottom banner
2. Clicks "Why this score?"    → blurred preview + "Operator $39/mo"
3. Clicks audio briefing       → 10s preview + "Creator $12/mo"
4. Tries Unheard               → blurred, ZERO data fetched
5. Trial day 6                 → persistent banner with their stats
6. Trial expiry                → personalized recap screen
```

---

## File Structure

```
~/Desktop/podlens/           ← Main project
├── index.html                 ← Main app
├── about.html
├── pricing.html
├── how-it-works.html
├── privacy.html
├── terms.html
├── extension.html
├── profile.html
├── settings.html
├── account.html
├── print.css                  ← PDF report styles
├── netlify/
│   ├── functions/             ← .mts serverless functions
│   └── edge-functions/        ← detect-region.ts
├── CLAUDE.md                  ← This file
└── package.json

~/Desktop/podlens-extension/   ← Chrome Extension (separate repo)
```

---

## Build Queue

| # | Prompt | Status |
|---|---|---|
| 1 | Rebrand + pricing + audio | ✅ Done |
| 2 | Signup gate + trial | ✅ Done |
| 2B | Stripe payments | ✅ Done |
| 3 | Citations + bias meter + layout + transcript | ✅ Done |
| 4 | Progressive loading + cards + Wrapped + reports | ⏳ Next |
| 5 | Embedded players + YouTube→RSS fallback | Queued |
| 6 | Social login + Spotify connection | Needs Google keys |
| 7 | Geo + i18n + Korean beta | Queued |
| 8 | Platform-first homepage + recovery UI | Queued |
| 9 | Chrome Extension MVP | Separate folder |
| 10 | Tier audit + analytics + final polish | Last |

---

## WHAT NOT TO DO

- ❌ Use "Clearcast" (old name) or "Audlens" — always PODLENS
- ❌ Show -100/+100 numeric bias score
- ❌ Use "Audio Lean" — always "Political Lean"
- ❌ Fetch Unheard data for non-Operator users (server-side gate)
- ❌ Implement Korean before international is working
- ❌ Use "Blindspot" (Ground News) — use "Unheard"
- ❌ Show blank loading screen — always progressive content
- ❌ Single-column layout on wide screens — use full 1400px width
- ❌ Truncate topic names with "..." — always wrap to 2 lines
- ❌ Fetch data then hide with CSS — gate server-side first
- ❌ Show RSS input as primary recovery — show search bar
- ❌ Say "this podcast is biased" — say "leans [direction]"
- ❌ Use the old $5/mo pricing anywhere

---

## Commit Convention

```bash
git add . && git commit -m "[description]" && git push origin main
```

---

*Podlens — Know what you're actually listening to*
*podlens.app | Netlify: podlens | Vanilla JS + Netlify Functions*

---

## Branding — Logo, Typography & Visual Identity

### The Core Problem to Fix
The PODLENS wordmark is currently plain text in a default font.
This signals "prototype" not "platform." Fix this everywhere.

### Wordmark Treatment
Use Playfair Display (already imported) with weight contrast:

```html
<span class="podlens-wordmark">
  <span class="pod">POD</span><span class="lens">LENS</span>
</span>
```

```css
.podlens-wordmark {
  font-family: 'Playfair Display', Georgia, serif;
  letter-spacing: 0.08em;
  line-height: 1;
}
.podlens-wordmark .pod  { font-weight: 400; color: inherit; }
.podlens-wordmark .lens { font-weight: 700; color: inherit; }
```

Apply to: main nav, mobile nav, footer, auth modals, extension sidebar,
PDF report headers, shareable cards, loading screens, browser tab title.

Color treatments:
- On navy (#0f2027): white wordmark
- On white/cream: navy (#0f2027) wordmark
- On cards/print: #1a1a1a wordmark

### Favicon + Meta Images

favicon.svg (place in project root):
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#0f2027"/>
  <text x="50%" y="50%" dominant-baseline="central"
        text-anchor="middle" fill="white"
        font-family="Georgia, serif" font-weight="700"
        font-size="18" letter-spacing="0">PL</text>
</svg>
```

In <head> of ALL HTML files:
```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:image" content="https://podlens.app/og-image.jpg">
<meta name="theme-color" content="#0f2027">
```

OG image (og-image.jpg, 1200×630):
Navy #0f2027 background, PODLENS wordmark large centered (white),
"Know what you're actually listening to" below in Inter white/70%,
"podlens.app" bottom right white/50%.
Generate via HTML Canvas and save as static file.

### Branded Loading Screen

Replace any generic spinner with:
```html
<div class="pl-splash">
  <span class="podlens-wordmark large">
    <span class="pod">POD</span><span class="lens">LENS</span>
  </span>
  <div class="pl-tagline">Know what you're actually listening to</div>
  <div class="pl-loader-bar"></div>
</div>
```

```css
.pl-splash {
  position: fixed; inset: 0; background: #0f2027;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 16px;
  z-index: 99999;
}
.podlens-wordmark.large { font-size: 48px; color: white; }
.pl-tagline { color: rgba(255,255,255,0.5); font-family: Inter; font-size: 16px; }
.pl-loader-bar {
  width: 120px; height: 2px; background: rgba(255,255,255,0.2);
  border-radius: 1px; overflow: hidden; margin-top: 8px;
}
.pl-loader-bar::after {
  content: ''; display: block; height: 100%;
  background: white; animation: pl-load 1.5s ease-in-out infinite;
}
@keyframes pl-load {
  0%   { width: 0; transform: translateX(0); }
  50%  { width: 60%; }
  100% { width: 0; transform: translateX(200px); }
}
```

### CSS Variable System — Define in :root on ALL Pages

```css
:root {
  /* Brand */
  --color-navy:     #0f2027;
  --color-navy-mid: #1a3a4a;
  --color-cream:    #FAF9F6;
  --color-text:     #1a1a1a;
  --color-muted:    #666666;
  --color-border:   #e0ddd8;

  /* Bias — NEVER change these */
  --color-left:     #E24B4A;
  --color-center:   #D1CFC9;
  --color-right:    #378ADD;

  /* Tier accents */
  --color-creator:  #7C6AF7;
  --color-operator: #0f2027;
  --color-studio:   #B8860B;

  /* Typography */
  --font-display: 'Playfair Display', Georgia, serif;
  --font-body:    'Inter', -apple-system, BlinkMacSystemFont, sans-serif;

  /* Type scale */
  --text-xs:   11px;
  --text-sm:   13px;
  --text-base: 15px;
  --text-lg:   18px;
  --text-xl:   24px;
  --text-2xl:  32px;
  --text-3xl:  48px;
  --text-hero: 56px;
}
```

Replace ALL hardcoded hex values throughout the codebase with these variables.

### Button System — Standardize Everywhere

```css
/* Primary */
.btn-primary {
  background: var(--color-navy); color: white;
  border: none; border-radius: 4px;
  padding: 12px 24px;
  font-family: var(--font-body); font-size: var(--text-sm); font-weight: 500;
  cursor: pointer; transition: background 0.15s;
}
.btn-primary:hover { background: var(--color-navy-mid); }

/* Secondary */
.btn-secondary {
  background: transparent; color: var(--color-navy);
  border: 1px solid var(--color-navy); border-radius: 4px;
  padding: 11px 24px;
  font-family: var(--font-body); font-size: var(--text-sm); font-weight: 500;
  cursor: pointer;
}

/* Platform */
.btn-spotify { background: #1DB954; color: white; border-radius: 4px; }
.btn-youtube { background: #FF0000; color: white; border-radius: 4px; }
.btn-apple   { background: #FC3C44; color: white; border-radius: 4px; }
.btn-kakao   { background: #FEE500; color: #1a1a1a; border-radius: 4px; }
```

All buttons use border-radius: 4px — NOT 8px+ — keeps the editorial feel.

### Brand Voice — Apply to ALL UI Copy

Podlens sounds like a smart friend who reads everything and tells you
what matters. Not an algorithm. Not a judge. Not a lecturer.

```
❌ "This episode contains 14 instances of right-wing framing"
✅ "This episode leans right — here's what shaped that"

❌ "Warning: heavily biased content detected"
✅ "Lightly one-sided — worth knowing going in"

❌ "Your podcast diet is dangerously one-sided"
✅ "Your listening leans 68% right — here's what that means"

❌ "Bias score: -73"
✅ "Heavily one-sided — but here are 3 great counterpoints"
```

Apply this voice to: every empty state, every error message,
every upgrade CTA, every onboarding step, every toast notification.

### What to Build Now vs Later

| Element | Now (Claude Code) | Later (Designer) |
|---|---|---|
| Wordmark typography | ✅ Implement now | — |
| CSS variable system | ✅ Implement now | — |
| Favicon (SVG) | ✅ Implement now | — |
| OG image | ✅ Generate via Canvas | — |
| Branded loading screen | ✅ Implement now | — |
| Button system | ✅ Implement now | — |
| Custom logo file | After first revenue | Fiverr $50-200 |
| App icon (iOS/Android) | Phase 3 | Designer |
| Marketing illustrations | Phase 2 | Midjourney or designer |

---

## GTM Strategy — Go-To-Market Rollout

### Phase 0 — Private Alpha (Now, 0 users)
Complete Prompts 4-10. Test yourself on 20+ real episodes.
Fix every broken state before anyone sees the product.
One bad first impression from a friend = lost evangelist.

### Phase 1 — Inner Circle Beta (10-20 people)
Personal invites only. Must be actual podcast listeners (5+ hrs/week).
Ask for brutal honesty. Give them the password (lens2026).
Watch: do they analyze more than 1 episode? That's the signal.

### Phase 2 — Controlled Beta (50-100 people)
Offer free Operator for life in exchange for:
- 5+ analyzed episodes
- 5-question feedback form
- One honest testimonial quote

Channels:
- Personal network post: "Beta access limited to 100 people, comment 'in'"
- Reddit seeding (r/podcasts, r/mediaskepticism) — one genuine comment per thread
- Direct outreach to 10 journalists/academics who write about media bias
- Korean community outreach (Facebook groups, KakaoTalk communities)

Goal: 500 analyzed episodes in database before public launch.

### Phase 3 — Waitlist (Before public launch)
Remove password. Add waitlist landing page.
Show beta testimonials + real bias cards + episode count.
"Join X people waiting for full access"
Build email list before charging anyone.

### Phase 4 — Public Launch
Channels in priority order:
1. Product Hunt (Tuesday/Wednesday — get 20+ supporters lined up)
2. Twitter/X thread with real surprising bias data from major shows
3. Reddit data post (r/podcasts, r/DataIsBeautiful)
4. Korean community launch (simultaneous — separate KakaoTalk outreach)

Launch when 80% of beta users say they would pay for it.

### Solo Founder Scaling Limits
- 0-100 paying users: fully manageable alone
- 100-500 users: need Intercom/Crisp + Sentry + good FAQ
- 500+ users: need Supabase migration (Netlify Identity hits 1K limit at ~800)
- 1,500+ users: need first hire
- 2,000+ users: need a team

### Critical Before Launch
- [ ] Test Stripe checkout with card 4242 4242 4242 4242
- [ ] Verify trial → free downgrade works correctly
- [ ] Verify Unheard returns no data server-side for free users
- [ ] Mobile layout works on 375px screen
- [ ] 20+ personal analyses without hitting a broken state
