# Campus Radar

Local-life / event-discovery platform for Northwestern students — aggregates events from public sources and user submissions, displayed Eventbrite-style.

See [PLANNING.md](PLANNING.md) for the full product plan, architecture, data model, and roadmap.

## Supabase

- Project: `campus-radar`, ref `lqirwngvveapraatpibe`, region us-east-1 — [dashboard](https://supabase.com/dashboard/project/lqirwngvveapraatpibe)
- Project settings: Data API on; "automatically expose new tables" off; automatic RLS on. New tables need explicit grants + RLS policies.
- Web setup: `cp .env.example apps/web/.env.local`, then paste the publishable key from Dashboard -> Project Settings -> API Keys.
- Schema lives in `supabase/migrations/` (Supabase CLI: `npx supabase login`, then `npx supabase link --project-ref lqirwngvveapraatpibe`).

## Status

The React/Vite starter is deployed on Cloudflare Workers at https://campus-radar.com. The initial Supabase schema is live. The follow-up poster/deduplication migration is committed for deployment; push it to Supabase before relying on these fixes. Page content and GitHub auto-deployment are still pending.

To change the schema, add a new file with `npx supabase migration new <name>`, then `npx supabase db push`. Don't edit migrations that have already been applied.

## Web development and deployment

Use Node 24 (`nvm use` inside `apps/web`), then:

```sh
cd apps/web
npm ci
npm run dev
```

`npm run build` checks TypeScript and builds the app; `npm run lint` checks the code.
`npx wrangler login` and `npm run deploy` publish to the signed-in Cloudflare account.
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
