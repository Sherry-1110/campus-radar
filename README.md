# Campus Radar

Local-life / event-discovery platform for Northwestern students — aggregates events from public sources and user submissions, displayed Eventbrite-style.

See [PLANNING.md](docs/PLANNING.md) for the full product plan, architecture, data model, and roadmap.

## Supabase

- Project: `campus-radar`, ref `lqirwngvveapraatpibe`, region us-east-1 — [dashboard](https://supabase.com/dashboard/project/lqirwngvveapraatpibe)
- Project settings: Data API on; "automatically expose new tables" off; automatic RLS on. New tables need explicit grants + RLS policies.
- The publishable key is under Dashboard -> Project Settings -> API Keys.
- Schema lives in `supabase/migrations/` (Supabase CLI: `npx supabase login`, then `npx supabase link --project-ref lqirwngvveapraatpibe`).

## Development

Use Node 24 (`nvm use` inside `apps/web`), then from the repo root:

```bash
npm install
cp .env.example apps/web/.env.local   # then paste the Supabase publishable key
npm run dev                           # http://localhost:5173
```

Other root scripts: `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run types:db` (regenerate `apps/web/src/lib/database.types.ts` after a schema change). Inside `apps/web` the same scripts work directly (`cd apps/web && npm run dev`).

## Discovery prototype and Google Maps

The implementation branch adds entertainment-first date shortcuts, packed image cards,
Google Maps with explicit **Search this area**, floating event details, a mobile bottom
sheet, and browser-local Saved events. Ranking and final visual styling remain deferred.

For a local prototype, set `VITE_GOOGLE_MAPS_API_KEY` and `VITE_GOOGLE_MAPS_DEMO=true`
in `apps/web/.env.local`, then restart Vite. The ignored local file must not be committed.
The demo uses Maps JavaScript API and **Geocoding API v4**, through a development-only
Vite endpoint. It keeps results in memory, deduplicates addresses, and caps each server
session at 50 distinct addresses. No hosted coordinate writes or scheduled jobs run.
Google's own demo quota can be lower: successful locations remain visible when a lookup
fails, with a quota/error message. Restart Vite after quota availability returns.

Only precise, unique US venue results in the Chicago region become pins. Unmapped
events stay in the normal feed; a selected map area excludes them. Pins cover the
matching located events independently of card pagination, but demo coverage is limited
by the lookup cap. Academic events remain accessible through categories or search;
the default relies on source categorization, so mislabeled source events can still appear.

Production setup is prepared but **not activated**:

1. Add a production browser key as the GitHub Actions repository secret
   `VITE_GOOGLE_MAPS_API_KEY`; restrict it to Maps JavaScript API and the website
   `https://campus-radar.com/*`. A billing-enabled Google Cloud project is required.
   Optionally set repository variable `VITE_GOOGLE_MAPS_MAP_ID`. CI injects these at
   build time; changing Cloudflare runtime settings alone cannot update the browser bundle.
   Local demo keys are not copied into production. Push or rerun CI after configuring the key.
2. The coordinate migration and generated database types were applied on 2026-10-02.
3. Configure a separate backend `GOOGLE_GEOCODING_API_KEY` for v4 and backend Supabase
   credentials. Never put backend credentials in `VITE_` variables.
4. Preview with `npm run coordinates -w @campus-radar/ingestion -- --limit 50`;
   an explicitly authorized `--apply` populates coordinates. `--purge` removes expired
   entries. The cache expires after 29 days; public reads hide expired entries and
   changed venue addresses invalidate them. Arrange approved refresh/physical cleanup
   before enabling persistent geocoding. No recurring workflow is configured here.
5. Complete the applicable Google Maps attribution, privacy, and terms requirements
   before publishing. The prototype keeps Google's map attribution visible.

See [Google's demo-key documentation](https://developers.google.com/maps/demo-key) and
[Geocoding v4 setup](https://developers.google.com/maps/documentation/geocoding/start-v4).

## Nightly event sync

PlanIt Purple and Bienen ingestion lives in `apps/ingestion`. The workflow runs at
08:17 UTC daily (02:17 or 03:17 Chicago time) and can also be run manually.
It inserts new official events, updates changed fields/cancellations, and leaves
unchanged events untouched. Source posters are used when available.

```sh
npm test
npm run sync:events -- --dry-run  # public sources only; no database writes
# Backend environment only: SUPABASE_URL plus SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY
npm run sync:events -- --apply
```

Apply the database migrations and configure the corresponding GitHub repository
secret before enabling writes. See [nightly sync operations](docs/NIGHTLY_SYNC.md)
for activation, source coverage, authority, and failure behavior.

The database currently holds sample events tagged `demo`. Remove them before launch with:

```sql
delete from public.events where 'demo' = any(tags);
```

## Status

The database schema and web app are live at https://campus-radar.com, including
event browsing, search/filters, detail pages, source posters, and cancellation/all-day
display. The nightly PlanIt Purple and Bienen workflow is active and its first complete
hosted import succeeded on September 20, 2026. Login, event submission,
and admin review are still pending.

To change the schema, add a new file with `npx supabase migration new <name>`. Review pending migrations with `npx supabase db push --linked --dry-run`, then apply them with `npx supabase db push --linked`. Don't edit migrations that have already been applied. The three previously missing history entries were repaired on 2026-09-21; do not rerun their SQL.

Recurring dates remain separate `events` rows linked by `series_id`. A database trigger
assigns imported rows to a series using known stable source links or exact detailed
content plus title, venue, source and year. Ambiguous matches stay separate; edited
content and year boundaries can split content-based matches. `browse_events` filters
occurrences before grouping and pagination. Saves and calendar links use occurrence IDs.
The existing rows were backfilled on 2026-10-02 without removing dates.

## Deployment

The existing [CI workflow](.github/workflows/ci.yml) tests, lints, type-checks, and builds
on pull requests and pushes to `main`. Successful `main` pushes then deploy Worker `web`
to https://campus-radar.com and verify that the live page references the new build.
Production runs are serialized; pull requests never receive deployment credentials.
The independent nightly event workflow is unchanged.

GitHub repository Actions secret `CLOUDFLARE_API_TOKEN` provides deployment access.
Scope the token to the site's Cloudflare account with Workers Scripts Edit and Account
Settings Read, and the `campus-radar.com` zone with Zone Read and Workers Routes Edit.
The non-secret account ID is recorded in the workflow. No Cloudflare GitHub App installation
is required. If a deployment fails, inspect CI's deploy step and re-run the failed job after
correcting the cause. Database migrations remain a separate, deliberate operation.

`apps/web/.env.production` contains only the public Supabase URL and publishable key,
which are intentionally shipped to browsers; RLS controls database access. Never put a
backend secret or service-role key in `VITE_` variables. Local `.env.local` can override
these values. The custom domain is tracked in `apps/web/wrangler.jsonc`.

For a manual deployment, run `cd apps/web`, `npx wrangler login`, then `npm run deploy`.

## Database regression checks

After applying migrations to a disposable local Supabase database, run:

```sh
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/regressions.sql
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/recurring_events.sql
```

The SQL checks poster ownership/deletion, unsafe poster URLs, and location-aware
deduplication, recurring-date grouping, filtering and public access; each test rolls back
its data. Do not point it at production.
Submission poster URLs currently use the production Supabase origin declared in the
migration; changing projects or using a local storage origin requires updating that validation.
