# Campus Radar

Local-life / event-discovery platform for Northwestern students — aggregates events from public sources and user submissions, displayed Eventbrite-style.

See [PLANNING.md](PLANNING.md) for the full product plan, architecture, data model, and roadmap.

## Supabase

- Project: `campus-radar`, ref `lqirwngvveapraatpibe`, region us-east-1 — [dashboard](https://supabase.com/dashboard/project/lqirwngvveapraatpibe)
- Project settings: Data API on; "automatically expose new tables" off; automatic RLS on. New tables need explicit grants + RLS policies.
- Local setup: `cp .env.example .env`, then paste the publishable key from Dashboard -> Project Settings -> API Keys.
- Schema lives in `supabase/migrations/` (Supabase CLI: `npx supabase login`, then `npx supabase link --project-ref lqirwngvveapraatpibe`).

## Status

Pre-development. Supabase project linked and the database schema (tables, RLS, storage, seed data) is live; next up: web app scaffold and Cloudflare Pages deploy — see PLANNING.md.

To change the schema, add a new file with `npx supabase migration new <name>`, then `npx supabase db push`. Don't edit migrations that have already been applied.
