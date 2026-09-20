# Campus Radar

Local-life / event-discovery platform for Northwestern students — aggregates events from public sources and user submissions, displayed Eventbrite-style.

See [PLANNING.md](PLANNING.md) for the full product plan, architecture, data model, and roadmap.

## Supabase

- Project: `campus-radar`, ref `lqirwngvveapraatpibe`, region us-east-1 — [dashboard](https://supabase.com/dashboard/project/lqirwngvveapraatpibe)
- Project settings: Data API on; "automatically expose new tables" off; automatic RLS on. New tables need explicit grants + RLS policies.
- Local setup: `cp .env.example .env`, then paste the publishable key from Dashboard -> Project Settings -> API Keys.
- Schema lives in `supabase/migrations/` (Supabase CLI: `npx supabase login`, then `npx supabase link --project-ref lqirwngvveapraatpibe`).

## Development

```bash
npm install
cp .env.example .env   # then paste the Supabase publishable key
npm run dev            # http://localhost:5173
```

Other scripts: `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run types:db` (regenerate `apps/web/src/lib/database.types.ts` after a schema change).

The database currently holds sample events tagged `demo`. Remove them before launch with:

```sql
delete from public.events where 'demo' = any(tags);
```

## Status

Early development. The database schema is live and the web app (`apps/web`) has the event browse page (search, filters) and event detail page. Next up: login, event submission, admin review, and the Cloudflare Pages deploy — see PLANNING.md.

To change the schema, add a new file with `npx supabase migration new <name>`, then `npx supabase db push`. Don't edit migrations that have already been applied.
