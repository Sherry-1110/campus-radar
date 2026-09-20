# Nightly event sync

## Implementation plan

Implement the approved PlanIt Purple + Bienen pipeline as a nightly reconciliation job. Fetch upcoming events and a recent-history overlap, compare normalized source snapshots using stable occurrence IDs, insert new events, and update only changed source fields. Explicit cancellations remain visible as canceled; missing events are never automatically canceled or deleted. Preserve manual edits when a source changes a field already edited by a curator. Use source-provided poster images, with the existing category fallback when none is available.

Run nightly at 08:17 UTC (03:17 Chicago daylight time / 02:17 standard time), with a manual dry-run option and non-overlapping runs. Newly imported official events are published; moderation changes to existing events are preserved. No social sources or AI extraction are part of this job.

1. Add tested source parsers using the observed XML/JSON formats, source IDs, date offsets, explicit cancellation markers, event images, and Bienen detail-page locations. Reject malformed feeds and candidates before writes.
2. Add private source snapshots and a service-only database RPC with atomic batches. Test first insert, unchanged rerun, edits, date change, cancellation/reinstatement, manual edits, duplicates, missing records, and unauthorized calls.
3. Add a Node 24 runner with dry-run/apply modes, retries, per-source isolation, source freshness and run summaries. Keep credentials in backend secrets.
4. Show canceled/all-day events accurately in existing cards/details/calendar exports. Verify frontend and ingestion tests, lint, typecheck, build, and a real-feed dry run.
5. Apply the migration and configure/verify GitHub scheduling where account permissions permit. Record any remaining activation steps and actual run results here.

Implementation is in the existing checkout, preserving the source research documents.

## Review focus

- Date changes must retain identity, including recurring performances.
- An empty, truncated, challenged, or failed response must not remove or cancel events.
- No event-row update on identical source content; curator edits survive source sync.
- All-day events, DST, unknown prices, canceled events, and missing posters remain truthful.
- Machine write access stays unavailable to anonymous and ordinary signed-in users.

## Running and activation

Requires Node 24. From the repository root:

```sh
npm ci
npm test
npm run sync:events -- --dry-run
npm run sync:events -- --dry-run --source bienen
```

Dry-run reads the sources and reports validated event/image counts without database
access. It is a coverage preview, not a prediction of database insert/update counts.
The summary is written to `apps/ingestion/sync-report.json` by default. `--report`
can choose another path. `--source` accepts `all`, `planitpurple`, or `bienen`.

For writes, set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (modern `sb_secret_…` key)
or `SUPABASE_SERVICE_ROLE_KEY` (legacy backend JWT) in the trusted environment, then:

```sh
npm run sync:events -- --apply
```

For GitHub Actions:

1. Apply pending migrations, including `20260920120000_nightly_event_sync.sql`.
   The project URL is already configured in the workflow. A backend API key alone
   cannot perform schema migrations; use the Supabase SQL Editor or an authenticated CLI.
2. Set one of the backend keys as a repository Actions secret with the matching name.
   Never use a browser publishable key or a `VITE_` variable for ingestion.
3. Push the workflow to the default branch. Run **Nightly event sync** manually with
   `apply=false` for a coverage check, then with `apply=true` for the first import.
4. Repeat the apply run to verify zero inserts/updates when source data is unchanged.
   Scheduled runs use apply mode. Review the summary/artifact for errors and conflicts.

The workflow has a 30-minute timeout, serializes overlapping runs, and retains
summary artifacts for 14 days. A failed source produces a failed job but does not
prevent the other source from syncing. GitHub schedules are best-effort and can
disable after 60 days of public-repository inactivity; check source freshness and
Actions status if updates stop. No artificial keepalive commits are generated.

## Reconciliation rules

- PlanIt Purple: full published future feed (`days=0`, publisher limit of five years),
  plus its 90-day archive overlap. Bienen: all future and previous 90 days from the
  available endpoint. No “created today” filter: revisiting existing upcoming events
  is essential to catch cancellations and edits. Older historical entries stop refreshing.
- IDs identify occurrences, not titles or dates. Bienen recurring performances use
  their instance/paragraph ID. Source data is normalized before comparison; fetch time
  and unrelated website metadata are excluded.
- A complete source is fetched and validated before writing. The service-only RPC
  commits batches of at most 100 candidates to stay within hosted database timeouts.
  Each batch is atomic. A later database failure leaves earlier committed batches
  intact; rerunning is safe and reports unchanged records. Missing fields, malformed
  responses, and empty feeds fail before any writes. The job has bounded response
  sizes and fetch retries. A failure is visible in GitHub logs.
- Explicit cancellation flags or recognized cancellation notices update `is_cancelled`.
  Disappearance or an unpublished Bienen record alone is not proof of cancellation.
  Removed listings require organizer confirmation/manual action; their absence is not
  turned into a fabricated status update.
- Canonical event links and exact title/time/location matches merge cross-source copies.
  Bienen outranks PlanIt Purple for matching concerts. Ambiguous fuzzy matches are not merged.
- Changed source fields update only when the current field still equals the previous
  source value. Curator corrections and moderation status are retained. Explicit
  cancellation takes precedence; conflict counts flag preserved manual fields.
  Legacy imports with no snapshot retain untracked content edits, bootstrap lifecycle
  flags, and report a conflict for review.
- Unchanged candidates do not write the event, provenance row, or private snapshot.
  The source timestamp and private batch summaries still advance. Therefore
  `event_sources.last_seen_at` is not a nightly freshness signal. `sources.last_fetched_at`
  indicates the last committed batch, while the GitHub run/report is authoritative
  for completion of the entire source; a partially failed run is never reported as healthy.
- Stored text respects database length limits; longer text is abbreviated with an
  ellipsis and the original source remains linked. Unknown fees display “See details.”
- Images are source-hosted event images, not copied or AI-generated posters. Missing
  or failed images use the existing category illustration. No promise of a real poster
  for every event is made when the organizer supplied none.
- All-day events use an inclusive local end-of-day internally, proper all-day calendar
  exports, and an “All day” label. Canceled details remain addressable and do not offer
  the ordinary add-to-Google-calendar action.

## Verification on September 20, 2026

- Live read-only run: PlanIt Purple 3,859 occurrences, 952 image URLs, 14 explicit
  cancellations; Bienen 68 performances, all 68 with image URLs. Counts include the
  recent-history overlap and can change with the source.
- Real cached-source integration against disposable PostgreSQL (PGlite): 2,276 PlanIt
  Purple occurrences and 68 Bienen records imported/reconciled, then identical second
  runs returned zero inserts and zero updates. This checks SQL behavior, not hosted
  Supabase permissions/network latency.
- Automated tests cover malformed feeds, stable recurring IDs, rescheduling, cancellation
  and reinstatement, source authority, legacy lifecycle bootstrap, manual edits,
  atomic rollback, private access, all-day DST, dry-run behavior, and source isolation.
- Activation is complete only after the hosted migration, default-branch workflow,
  backend secret, and first successful apply run are verified.
- Hosted verification caught a statement timeout on the initial 3,859-item PlanIt
  Purple transaction. The permanent runner now uses 100-item transactions, covered
  by a batching/partial-failure regression test. No temporary repair workflow was added.
- Activation verified: hosted columns/RPC and backend secret work; the public key is
  denied RPC execution. [Successful hosted run](https://github.com/Sherry-1110/campus-radar/actions/runs/35493999927)
  completed at 06:21 UTC: PlanIt Purple inserted 3,803 events and linked 56 occurrences;
  Bienen's 68 previously imported performances were all unchanged (zero updates).
  The report recorded 15 conflicts while linking existing records; preserved content
  was not forcibly overwritten. Review source snapshots before changing such records.
- All 15 automated tests, lint, typecheck, and GitHub CI pass. Production web build and
  deployment succeeded; Cloudflare version `b3fd22aa-c272-4493-b0bf-7ddb8bf0f659`.
  Browser verification showed real imported cards, all-day labels, and a canceled
  event detail with cancellation messaging and no ordinary add-to-calendar action. The production
  build retains the pre-existing warning about a client chunk larger than 500 kB.
