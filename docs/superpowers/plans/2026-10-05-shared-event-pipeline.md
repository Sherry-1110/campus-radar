# Shared event pipeline implementation plan

Goal: durable, replayable shared ingestion, expanded with the six agreed source adapters where public access works.
Architecture: private partitioned response store + run manifests + normalized staging; existing canonical reconciliation and enrichment.
Spec: ../specs/2026-10-05-shared-event-pipeline.md
Stack: current Node/TypeScript, Supabase Postgres, GitHub Actions; existing dependencies.

- [x] Raw capture and replay transport: tests for persistence-before-parse, cache-key cleanup, missing replay input, fixed clock and private access.
- [x] SQL migration: source partitions, run/stage RPCs, incomplete-run guards, atomic publication/provenance, bounded retention. Exercise with existing PGlite migration test.
- [x] Shared runner: stage normalized input before enrichment, stage enriched output before publishing, preserve optional failure behavior, wire replay CLI and current metadata jobs.
- [x] Deduplication: normalized event-specific URL and conservative venue/title matching; regression cases for duplicates versus separate showtimes.
- [x] Source adapters in parallel: Cats/Downtown, SPACE/Do312, Music Box/Second City. Source-specific fixtures and real probes, no guessed dates.
- [x] Registry/workflow/docs: enable verified sources, keep blocked sources explicit, publish common stage health.
- [ ] Full tests/lint/types, independent review, production migration/deployment, live source runs and DB verification.

Rulings: reuse existing isolated checkout and existing enrichment jobs. Source adapters are independent delegated tasks per dispatching-parallel-agents skill. User's repeated deployment/database authorization applies to this approved change.
