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
│ (GitHub Actions)   │     │ (Postgres + Auth)  │     │ (Cloudflare Workers)  │
└──────────────────┘     └──────────────────┘     └───────────────────┘
  structured sources:          user submissions /         visitors browse,
  automated cron scrapers      admin review queue          logged-in users submit
  social sources:
  human-curated "quick add"
  tool (LLM-assisted extraction
  from pasted post links/text)
```

- **Frontend**: React (Vite), deployed on Cloudflare Workers with Static Assets, talks to Supabase directly via JS SDK + Row Level Security (no custom backend needed for basic CRUD).
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

## Data model (Supabase / Postgres — implemented)

Source of truth is `supabase/migrations/`; this is the target schema summary. The initial schema is live since 2026-09-19; the 20260920040000 poster/deduplication fix still needs to be applied to the hosted database.

| Table | Purpose |
|---|---|
| `schools` | Launch market (Northwestern seeded) with `email_domain` used for verification; keeps multi-school expansion cheap |
| `profiles` | 1:1 with `auth.users`, created by trigger. `role` (student/curator/admin), `school_id`, `is_school_verified` (true only for a *confirmed* email on the school's domain or a subdomain) |
| `sources` | Where events come from: `type` (calendar_scrape / social_manual / user_upload / eventbrite_api), `url`, `fetch_interval`, `last_fetched_at`, `is_active`. Seeded with 9 sources |
| `events` | Title, description, cover image, `start_time`/`end_time` (timestamptz, display in America/Chicago), location, `is_free`/`fee_text`, `category` (enum), `tags[]`, `status` (draft/pending_review/published/rejected), `created_by`. Generated columns: `dedupe_key` (normalized title + start minute + normalized location; unique per school as an exact-duplicate backstop) and `search` (tsvector) |
| `event_sources` | Provenance: every source that reported an event (`source_id`, `external_id`, `source_url`, first/last seen). Unique on `(source_id, external_id)` for scraper upserts; dedupe merges here instead of discarding |
| `submissions` | Review record for user-submitted events; approving/rejecting it publishes/rejects the event and stamps `reviewed_by`/`reviewed_at` via trigger |
| `mailing_list_subscribers` | `email`, `frequency`, `categories[]`, `confirmed_at`, `unsubscribe_token`; anon can insert only |

Categories: arts, music, sports, academic, career, social, wellness, food, other. Recurring events (e.g. GroupX) are stored as expanded individual rows.

### Access model
- "Automatically expose new tables" is off: every table has explicit grants **and** RLS. The `service_role` key (ingestion) needs explicit grants too.
- Anon/public: read `published` events, their `event_sources`, `sources`, `schools`; insert-only on the mailing list.
- Signed-in: also read own events/submissions/profile; edit only own `display_name`.
- Users cannot insert events directly. They call the `submit_event()` RPC, which requires `is_school_verified`, forces `status = pending_review` and `created_by = auth.uid()`, and creates the `submissions` row atomically.
- Curators/admins (`profiles.role`, set manually via SQL by the owner) can read/write everything and review submissions. Helper functions (`is_staff`, `is_verified`) live in the non-exposed `private` schema.
- Storage: public-read `event-posters` bucket (5 MB, jpeg/png/webp); verified users upload only under `<their user id>/`.
- Known/accepted advisor warning: `submit_event` is a `SECURITY DEFINER` function callable by signed-in users (by design).

## Roadmap

**Phase 0 — Foundations**
- [x] GitHub repo (public, collaborator invited)
- [x] Supabase project created and linked (`lqirwngvveapraatpibe`)
- [x] Schema, RLS, storage bucket, seed data applied and tested (see Data model)
- [x] Monorepo scaffold: npm workspaces, `apps/web` (Vite + React + TS + Tailwind v4 + TanStack Query + React Router), GitHub Actions CI
- [x] Web: browse page (search, date/category/free filters, load-more), event detail page (add to calendar, .ics, copy link), 15 sample events tagged `demo`
- [x] Cloudflare Workers (Static Assets) config and a manual deployment on `campus-radar.com` (currently the starter page; redeploy to publish the real app)
- [ ] Apply migration `20260920040000` (poster permissions, location-aware dedupe) to the hosted database
- [ ] Ingestion scaffold: `apps/ingestion`
- [ ] Cloudflare GitHub integration authorized by the repository owner, auto-deploy on push

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
| Frontend | React (Vite) on Cloudflare Workers with Static Assets | See current Cloudflare Workers limits |
| Ingestion | GitHub Actions (cron) | Unlimited min on public repos / 2,000 min/mo private |
| Database + Auth | Supabase | 500 MB Postgres + Auth |
| Light dynamic API | Cloudflare Workers | 100k req/day |
| Email digest | Resend (tentative) | — |

Total cost: $0 to start.
