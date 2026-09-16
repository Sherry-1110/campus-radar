# Campus Radar — Planning

Local-life / event-discovery platform for Northwestern students (multi-school later). Aggregates events from public sources and user submissions, displays them Eventbrite-style.

## Product idea

- Event cards: poster, name, time, location, info, fee — like Eventbrite.
- Users can browse events and also submit their own.
- Long-term channels: website (first), mailing list, then WeChat / RedNote / etc.

## Event sources

**Structured (can be auto-scraped)**
- Eventbrite (has an official API)
- PlanItPurple — https://planitpurple.northwestern.edu/
- Bienen School of Music calendar — https://www.music.northwestern.edu/events/calendar
- Wirtz Center for the Performing Arts — https://wirtz.northwestern.edu/
- NU Recreation GroupX schedule — https://nurecreation.com/sports/groupx/schedule (posted once/term, fairly static)
- Weekly "Pawprints" email announcements (academic + wellness)

**Social media (do NOT auto-scrape — see Architecture notes)**
- Instagram accounts to monitor: Student Affairs, MSA, Norris Center, Northwestern CAPS, NU_csaw, dittmargallery, nusailingcenter, nuwritingplace, nu_rsl, sustainnu, nunasiapowwow, nuarchsociety, northwestern_loc, nu_sesp_tlep, lunaspub.nu, studentaffnu, wirtzcenter, nuactiveminds, nurecreation, around_evanston, palmhouse619
- @chicago_forfree (Xiaohongshu/Instagram) — most comprehensive Chicago event roundups
- @inChicago (Xiaohongshu) — weekend roundups
- Plan: follow these orgs' reposts to gradually discover more student club accounts

**Chicago city-wide (weekly manual curation)**
- choosechicago.com/blog/special-events/things-to-do-in-chicago-this-month/
- thesavvyglobetrotter.com/things-to-do-this-weekend-chicago/ (sister pages: -this-week-chicago, -next-weekend-chicago)

**Other**
- The Garage (campus entrepreneurship hub) open events
- Cats on Campus and other campus apps
- Physical bulletin boards in academic buildings (photograph + manual entry while passing by)
- User uploads

## Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│  Ingestion layer   │ ──> │   Supabase         │ <── │  React frontend     │
│ (GitHub Actions)   │     │ (Postgres + Auth)  │     │ (Cloudflare Pages)  │
└──────────────────┘     └──────────────────┘     └───────────────────┘
  structured sources:          user submissions /         visitors browse,
  automated cron scrapers      admin review queue          logged-in users submit
  social sources:
  human-curated "quick add"
  tool (LLM-assisted extraction
  from pasted post links/text)
```

- **Frontend**: React (Vite), deployed on Cloudflare Pages, talks to Supabase directly via JS SDK + Row Level Security (no custom backend needed for basic CRUD).
- **Database / Auth**: Supabase (Postgres + Auth + Storage for poster images).
- **Ingestion**: GitHub Actions scheduled workflows run scraper scripts — not Vercel or Cloudflare Workers.
- **Dynamic/light API** (if ever needed): Cloudflare Workers, for things like mailing-list subscribe confirmation. Never for scraping (50 subrequest/request cap on free tier).

### Why GitHub Actions for ingestion, not Vercel/Workers
- Vercel Hobby plan is restricted to non-commercial use only — risky once there's any sponsor/ad/paid tier. Cloudflare Pages free tier has no such restriction.
- Cloudflare Workers free tier caps at 50 subrequests/request — a multi-source scraper blows through that immediately.
- GitHub Actions gives a full Linux VM, 6-hour timeout, no subrequest cap, automatic failure emails, one-click re-runs with logs — important because scrapers *will* break when a source changes its HTML.
- Caveats: scheduled workflows auto-disable after 60 days of repo inactivity (keep committing, or add a keepalive step); GitHub cron is best-effort and can run 10–60+ min late — schedule at an odd minute (e.g. `17 11 * * *`), not on the hour.

### Why not auto-scrape Instagram/Xiaohongshu
No public third-party scraping API; scraping risks account bans and ToS violations, and this content needs human judgment anyway (the source doc itself says "人工筛选推荐" for some of these). Instead: build an internal "quick add" tool — a curator pastes a post link/screenshot/text, an LLM assists extracting title/time/location/poster, curator confirms, it publishes. Human-curated + AI-assisted, not automated scraping.

## Data model (Supabase / Postgres, draft)

```sql
events (
  id, title, description, cover_image_url,
  start_time, end_time, location, location_url,
  fee, category, source_id, source_url,
  status,        -- draft / pending_review / published / rejected
  dedupe_key,    -- hash(title + date + location), fuzzy-matched before insert
  created_by,    -- null = system-scraped, else user_id
  created_at
)

sources (
  id, name, type,   -- 'calendar_scrape' / 'social_manual' / 'user_upload' / 'eventbrite_api'
  url, fetch_frequency, last_fetched_at, is_active
)

users (
  id, email, display_name, school,   -- 'school' reserved for multi-school expansion
  is_nu_verified,   -- @northwestern.edu email
  role              -- student / curator / admin
)

submissions (
  id, event_id, submitted_by, review_status, reviewer_notes, reviewed_by
)

mailing_list_subscribers (
  id, email, frequency, categories[]
)
```

## Roadmap

**Phase 0 — Foundations**
- GitHub repo (monorepo: `apps/web`, `apps/ingestion`, `supabase/migrations`)
- Supabase project + schema/RLS above
- Cloudflare Pages connected to repo, auto-deploy on push

**Phase 1 — MVP**
- Scraper adapters for 3–5 highest-value structured sources (PlanItPurple, Eventbrite, Bienen calendar, Wirtz, GroupX schedule); each source isolated so one failing doesn't break the run
- React frontend: Eventbrite-style event grid, detail page, filter by date/category
- User submission form (manual review via Supabase table editor is fine at this stage)
- Ship it

**Phase 2 — Review workflow + social sources**
- Admin moderation dashboard (approve/edit/reject scraped + submitted events)
- Build the "quick add" curator tool for Instagram/Xiaohongshu sources
- Add Chicago city-wide sources (RSS/API if available, else manual weekly curation)
- Weekly mailing-list digest (subscribers in Supabase + Resend for sending + GitHub Actions weekly cron)

**Phase 3 — Growth**
- Multi-school expansion (`school` field already reserved in schema)
- Push events outward to WeChat/Xiaohongshu, not just ingest
- Personalization / recommendations

## Known risks, roughly by likelihood

1. Scrapers break when a source changes its HTML — ongoing maintenance cost, unrelated to hosting choice.
2. Full auto-scraping of Instagram/Xiaohongshu would likely get rate-limited or banned — stick to the human-curated quick-add tool.
3. Dedup logic — same event reported across multiple sources with slightly different text; fuzzy matching can miss or false-positive, needs a manual review fallback.
4. Supabase free tier pauses projects after a week of inactivity — daily ingestion cron in Phase 1 avoids this incidentally.

## Stack summary

| Layer | Choice | Free tier |
|---|---|---|
| Frontend | React (Vite) on Cloudflare Pages | Unlimited bandwidth, 500 builds/mo |
| Ingestion | GitHub Actions (cron) | Unlimited min on public repos / 2,000 min/mo private |
| Database + Auth | Supabase | 500 MB Postgres + Auth |
| Light dynamic API | Cloudflare Workers | 100k req/day |
| Email digest | Resend (tentative) | — |

Total cost: $0 to start.
