# Clearcast
Podcast bias intelligence platform — "Like Ground News, but for podcasts"

**Live:** https://clearcast-app.netlify.app
**GitHub:** https://github.com/academekorea/Clearcast (private)
**Netlify Site ID:** 336b4d9b-fcc0-4675-a7d8-f61022fc2cdc

## Stack
- **Frontend:** index.html (vanilla JS, no framework)
- **Backend:** netlify/functions/ (TypeScript .mts)
- **Storage:** Netlify Blobs
- **Transcription:** AssemblyAI v2
- **Analysis:** Claude API (claude-sonnet-4-20250514)
- **Deploy:** GitHub → Netlify auto-deploy on push to main

## Functions
| File | Route | Purpose |
|------|-------|---------|
| analyze.mts | POST /api/analyze | Submit audio/YouTube URL |
| status.mts | GET /api/status/:jobId | Poll + run Claude analysis |
| stories.mts | GET /api/stories?q= | Search YouTube for episodes |
| marketplace.mts | GET /api/marketplace?genre= | Browse top shows |
| episodes.mts | GET /api/episodes?url= | Parse RSS feed |
| blindspot.mts | GET /api/blindspot | Unheard report data |
| show-profile.mts | GET /api/show-profile?id= | Show intelligence profile |

## Environment Variables
| Key | Purpose |
|-----|---------|
| ANTHROPIC_API_KEY | Claude analysis |
| ASSEMBLYAI_API_KEY | Transcription |
| YOUTUBE_API_KEY | YouTube search |

## Rules
- Always read CLEARCAST_ROADMAP.md before starting any new feature task
- Never break existing working features
- Validate JS syntax before committing index.html changes
- No frameworks — keep frontend vanilla JS

## Current Phase
Phase 1 — Foundation & Core Intelligence (see CLEARCAST_ROADMAP.md for full details)
