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

The database currently holds sample events tagged `demo`. Remove them before launch with:

```sql
delete from public.events where 'demo' = any(tags);
```

## Status

The database schema is live and the web app (`apps/web`) has the event browse page (search, filters) and event detail page. The live site at https://campus-radar.com still serves the earlier React/Vite starter until someone runs `npm run deploy` (see below). The follow-up poster/deduplication migration (`20260920040000`) is committed but not yet applied to Supabase; run `npx supabase db push` before relying on it. Login, event submission, admin review, and GitHub auto-deployment are still pending.

To change the schema, add a new file with `npx supabase migration new <name>`, then `npx supabase db push`. Don't edit migrations that have already been applied.

## Deployment

The web app deploys to Cloudflare Workers with Static Assets. `cd apps/web`, then `npx wrangler login` and `npm run deploy` publish to the signed-in Cloudflare account (the build reads `apps/web/.env.local`, so the Supabase variables must be set there).
The custom domain is tracked in `apps/web/wrangler.jsonc`.
Only the Supabase publishable key belongs in browser `VITE_` variables, never a service-role key.

For GitHub auto-deployment, the repository owner must authorize Cloudflare's GitHub app.
Use Worker name `web`, root `apps/web`, build command `npm run build`, deploy command
`npx wrangler deploy`, and production branch `main`.

## Database regression checks

After applying migrations to a disposable local Supabase database, run:

```sh
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/regressions.sql
```

The SQL checks poster ownership/deletion, unsafe poster URLs, and location-aware
deduplication; each test rolls back its data. Do not point it at production.
Submission poster URLs currently use the production Supabase origin declared in the
migration; changing projects or using a local storage origin requires updating that validation.
