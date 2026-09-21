# Nightly event sync

## Implementation plan

Implement the PlanIt Purple, Bienen, Choose Chicago, and The Garage pipeline as a nightly reconciliation job. Fetch upcoming events and a recent-history overlap, compare normalized source snapshots using stable occurrence IDs, insert new events, and update only changed source fields. Explicit cancellations remain visible as canceled; missing events are never automatically canceled or deleted. Preserve manual edits when a source changes a field already edited by a curator. Use source-provided poster images, with the existing category fallback when none is available.

Run nightly at 08:17 UTC (03:17 Chicago daylight time / 02:17 standard time), with a manual dry-run option and non-overlapping runs. Newly imported source events are published; moderation changes to existing events are preserved. No social sources are part of this job. Optional Jev matching and passage selection run within the same workflow, as described below.

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
can choose another path. `--source` accepts `all`, `planitpurple`, `bienen`, `choose-chicago`, or `garage`.

For writes, set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (modern `sb_secret_…` key)
or `SUPABASE_SERVICE_ROLE_KEY` (legacy backend JWT) in the trusted environment, then:

```sh
npm run sync:events -- --apply
```

For GitHub Actions:

1. Apply pending migrations, including `20260920120000_nightly_event_sync.sql` and
   `20260920180000_source_monitoring.sql` and `20260920210000_original_source_details.sql`.
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
prevent any other source from syncing. Each adapter runs in its own matrix job with
`fail-fast: false`; logs and report artifacts are named by source. GitHub schedules are best-effort and can
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
  Authority is configured on `sources`: direct organizers (30) outrank PlanIt Purple (10),
  which outranks city aggregators (5). Ambiguous fuzzy matches are not merged.
- Changed source fields update only when the current field still equals the previous
  source value. Curator corrections and moderation status are retained. Explicit
  cancellation takes precedence; conflict counts flag preserved manual fields.
  Legacy imports with no snapshot retain untracked content edits, bootstrap lifecycle
  flags, and report a conflict for review.
- Unchanged candidates do not write the event, provenance row, or private snapshot.
  The source timestamp and private batch summaries still advance. Therefore
  `event_sources.last_seen_at` is not a nightly freshness signal. `sources.last_fetched_at`
  indicates the last committed batch, while `source_health` and the GitHub run/report describe completion
  of the entire source. A partially failed run is never reported as healthy.
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


## Source modules and central monitoring (September 20 expansion)

Each adapter lives in `apps/ingestion/src/sources/`; common parsing helpers contain no
source orchestration. `registry.ts` connects the adapter, stable CLI key, database name,
and allowed network hosts. Adapters load only when selected. Feed requests stay within each adapter's
allowed hosts; optional organizer-page requests use the separate public-URL guard described below.
Each scheduled matrix job has its own process and 30-minute limit. Tests run in
CI; nightly jobs only install and sync, so a source-specific test failure does not prevent
unrelated production sources from running.

| Adapter | Coverage | Source identity | Posters |
| --- | --- | --- | --- |
| `planitpurple` | Publisher's full future feed plus 90-day archive | PiP occurrence ID | Feed image |
| `bienen` | All available future performances plus 90 days back | Instance/paragraph/node ID | Drupal featured image |
| `choose-chicago` | Requests 90 days back through 365 days forward; actual archive availability varies | API occurrence ID | API event image |
| `garage` | Available calendar, ignoring events ended more than 90 days ago | iCalendar UID; recurring original local start | Event page image, excluding generic provider artwork |

Choose Chicago uses its public Events Calendar REST endpoint, with full 50-item
pagination. Missing pages, duplicate IDs, changing totals, invalid dates or more than
20,000 records fail the source explicitly instead of silently truncating. Live verification:
7,976 occurrences, 7,758 images, 990 explicitly free, zero cancellation markers, 160 pages
in 252 seconds. Although the requested lookback started June 22, the publisher returned
nothing before August 19. Listings outside the configured window or removed by a publisher
cannot be reconciled from that snapshot; absence never fabricates cancellation.

The Garage uses the public [AddEvent calendar](https://www.addevent.com/calendar/Id622001)
and its linked [iCalendar feed](https://www.addevent.com/feed/eehiaisow.ics). Live verification:
14 occurrences, 12 upcoming, no cancellations, no genuine posters. Attendance restrictions
(e.g. resident teams only) remain in descriptions. The observed finite single-weekday
recurrence rules, recurrence exceptions and exclusions are supported with DST-aware times;
an unsupported rule fails visibly. Truncated publisher descriptions remain linked to the
original listing. Wirtz and PawPrint already overlap the broad PlanIt Purple import; adding
another scraper for those calendars would duplicate coverage.

`/sources` is the central monitor. It refreshes every minute and shows latest attempt,
last full success, counts, posters, change counts and a GitHub run link. Healthy means a
successful full run within 36 hours. Running attempts over an hour become Stalled; older
successes become Overdue. Failures remain Failed even when an earlier run was successful.
Dry runs never change production monitoring. If recording health itself fails, the job fails
and the previous status eventually becomes stale; consult GitHub if database access is down.

The public table contains only timestamps, numeric counts, fixed error codes and repository
run URLs. Anonymous/authenticated clients can read it but cannot write it or call the
service-only monitoring functions. Raw errors stay in job logs/reports. Beginning a new
attempt retains the previous success time; an older run cannot overwrite a newer run's
result or write further event batches; every batch validates its current run ID. Hard-killed jobs remain Running then Stalled. This is latest-state monitoring;
14-day GitHub artifacts provide per-run history, rather than an additional log service.

To add another source: implement and test one adapter; register its key/name/allowed hosts;
add a migration registering its `adapter_key` and authority on `sources`; add the key to
the existing workflow matrix. Preview it first, then apply using the same recurring workflow.
No temporary or one-off workflow is required.

Expansion checks: 31 automated tests, lint, typecheck and production build pass. Browser
preview verified Healthy, Failed, Overdue and Stalled cards using temporary sample data.
Expansion activated on September 20, 2026: migration applied through the project SQL
Editor after owner access was granted. Code `dbba8af` is on main; its CI passed.
Cloudflare deployment `e90085bd-654a-4441-bba8-bb7cf54e4c3c` serves `/sources`.
[First four-source apply run](https://github.com/Sherry-1110/campus-radar/actions/runs/35495820637)
completed successfully in all four independent jobs:

| Source | Candidates | Images | Inserted | Linked | Unchanged |
| --- | ---: | ---: | ---: | ---: | ---: |
| PlanItPurple | 3,859 | 952 | 0 | 0 | 3,859 |
| Bienen | 68 | 68 | 0 | 0 | 68 |
| Choose Chicago | 7,976 | 7,758 | 7,912 | 64 | 0 |
| The Garage | 14 | 0 | 14 | 0 | 0 |

Choose Chicago reported 64 conflicts while linking existing event identities; the importer
preserved existing content rather than overwriting without a source baseline. No source
reported a failed run. Production API checks confirmed the four monitor records succeeded
and the public key is denied the monitoring write RPC. Browser verification showed all four
sources Healthy with correct counts and GitHub run links. A cached 50-event city sample
also passed disposable PostgreSQL import/reimport with zero inserts or updates on the
second identical run.

## Original organizer details

After parsing a source, the shared enrichment step follows its event-specific `related_url`.
PlanIt Purple supplies its “more info” URL and Choose Chicago supplies its event website;
Bienen and The Garage already fetch their detail pages in their own adapters. New adapters
can expose an organizer link through the same candidate field.

The step checks matching Event JSON-LD (including occurrence date/range), or matching page
headings and article content. It retrieves organizer descriptions and image URLs, then follows
one further explicit event-information link when available. It keeps calendar occurrence times,
venue, price, cancellation and attendance restrictions. A production's multi-day structured
date range never replaces an individual performance time. Generic calendars, unrelated events,
login pages and generic logos are not accepted as event details. Matching uses conservative
title/date heuristics, so some valid pages will be skipped until a source-specific parser is needed.
Shortened organizer titles can also be corroborated by substantial matching calendar-description
phrases within one article paragraph, plus a meaningful shared title word. This handles the
Sheil Mass page linked from PiP event 645684 without accepting an unrelated title, a weekday-only
schedule for Sunday Mass, or contradictory structured event dates. Regression coverage includes
the missing organizer image and additional visit details; calendar occurrence times remain intact.

The original organizer becomes the event's primary source link; `event_sources` retains the
discovery listing for attribution; event details display only the primary original source,
falling back to the listing when no original is verified. Verified field provenance and the visited chain
stay in the private snapshot. If a later request fails or loses a field, the SQL wrapper retains
previously verified content while its underlying calendar field and related URL remain unchanged.
Calendar changes still reconcile, and existing curator-edit protection still applies.

Enrichment covers ongoing/recent events and the next 180 days. Each source gets at most 400
distinct pages and eight minutes, with four workers, serial requests per host, and shared fetches
for recurring occurrences. The nearest ongoing/upcoming occurrence for each organizer is visited
before repeats or recent past occurrences; daily ordering breaks ties. Each request has a 20-second
deadline, 2 MiB HTML limit and at most three redirects. Only public HTTPS destinations are allowed:
credentials and private/reserved addresses are rejected, every redirect is checked, and validated
DNS answers are pinned to prevent rebinding. No browser session, backend secret or cookie is sent.

`/sources` reports enriched/checked occurrence counts and unavailable original-page checks.
Optional page failures do not stop calendar updates. Reports also count checks deferred by the
budget; counts describe this run, not total stored enriched events. Images remain source-hosted;
not every organizer supplies a poster. JavaScript-only or access-restricted pages are skipped;
there is no autonomous browser agent or login bypass in this version. This uses the existing nightly workflow.

Activation checks on September 20: 45 tests, typecheck, lint, build and GitHub CI passed.
The migration was applied through Supabase SQL Editor; public RPC writes remain denied.
Code `6ab4094` was deployed as Cloudflare version `824ac42f-0b7e-4e11-9aa7-19db19b5fa89`.
The first enriched [nightly workflow run](https://github.com/Sherry-1110/campus-radar/actions/runs/35496826587)
checked 1,054 PlanIt Purple occurrences, matched organizer details for 283, updated 180 stored
events, and left 3,679 unchanged, with no conflicts. Image coverage grew from 952 to 1,014.
Its 91 unavailable page checks did not block the calendar sync and appear on `/sources`.
Browser verification confirmed a recovered image, additional organizer text, preserved
occurrence time and both attribution links on the live massage-special event.
All four jobs completed successfully. Choose Chicago checked 2,751 occurrences and enriched
743, with 740 stored events updated and 7,236 unchanged. Image coverage rose from 7,758 to
7,769; four conflicts preserved existing edits. It reported 355 unavailable checks and
2,364 checks deferred by the 400-page budget, which rotates on later nights. Bienen's 68
and The Garage's 14 existing events stayed unchanged. The production monitor confirms all
four sources succeeded and exposes enrichment counts independently of calendar health.


## Jev semantic matching and distillation

The existing nightly workflow supplies `TYPESAFE_API_KEY` from repository Actions secrets.
It calls the pinned `jev-1.13.0` API; no model server, new hosting service, or frontend key
is needed. `JEV_MODE=shadow` records decisions while preserving the rule-based output;
`JEV_MODE=apply` uses accepted decisions. Omitting the mode retains the original importer.

Before each applicable source run, six live cases must pass: recurring Sheil Mass with
relevant visitor information, a paraphrased concert title, conflicting occurrence dates,
wrong campus/weekday, a generic directory, and malicious instructions inside page text.
Failure disables semantic decisions for that source run while calendar imports continue.
This small evaluation is a rollout check, not a universal accuracy guarantee.

The page is reduced to bounded text blocks with heading context, structured event metadata,
and public image/link candidates. One request asks for occurrence/series/unrelated/insufficient
classification, relevance of each paragraph, and image/next-link selection. Code copies
selected source text and URLs verbatim: Jev cannot invent an output URL or rewrite dates,
prices, venue, status, or attendance restrictions. It is text-only; image selection uses
captions and page metadata, not visual inspection. Contradictions or uncertainty defer
enrichment and keep previously verified fields where the source baseline is unchanged.

Accepted relations require at least 0.9 selected-option probability and 0.8 confidence;
passages require 0.9 relevance probability. These are conservative initial gates evaluated
on the included examples, not calibrated accuracy claims. API failures and budget deferrals
fall back to the existing rules. Failures retain prior verified values through the current
SQL reconciliation. The model version, outcome, page evidence hash and selected text are
stored in private source snapshots, separate from public event fields.

A content/context/prompt/model-keyed disk cache is restored by GitHub Actions separately
for each source. It holds public-source judgments, never API keys, with a 30-day read TTL.
Changed occurrence dates, source text, questions, or model versions invalidate reuse.
Each source is limited to 150 API attempts and ten minutes of model work, in addition to
existing page-fetch limits. Requests time out after 20 seconds; 429/5xx get one retry.
Cache write failures do not stop the import. Deferred work uses the same nearest-event priority
and daily tie ordering. Persistent queueing can replace this bounded approach if coverage stalls.

Reports and the linked GitHub summary show evaluation outcome, accepted/unmatched/uncertain/
failed/deferred decisions, cache hits, API attempts and input tokens. `/sources` continues
to show calendar health and overall enrichment counts, linking to those detailed reports.
No autonomous browsing, embedding database, generative rewriting, or hosting migration is
part of this first integration.

The production workflow enables `JEV_MODE=apply`. Manual runs can select one source or
all sources; scheduled runs always use all four independent adapters. The write checkbox
controls database writes separately from semantic mode. Original-page work interleaves
organizers before repeated occurrences, prioritizes their nearest events, then rotates ties daily. Evaluation or
budget failures preserve prior verified enrichment when its calendar baseline is unchanged.

The September 20 rollout preview passed all six live cases. Its first 150 API attempts
used 886,734 input tokens and yielded 33 accepted, 14 unmatched, 102 uncertain and one
failed decision. This is coverage evidence, not an accuracy estimate. Bounded selected-text
samples are included in report artifacts for reviewing the decisions.

Production verification: [run 35499353044](https://github.com/Sherry-1110/campus-radar/actions/runs/35499353044)
completed successfully for all four sources. PlanItPurple updated 35 of 3,859 events;
Choose Chicago updated 33 of 7,976; Bienen's 68 and The Garage's 14 were unchanged.
Both semantic evaluations passed; 104 page decisions were accepted, with no API failures
in the enrichment phase. The public Sheil event retained its organizer photo and replaced
the broad multi-campus article with the relevant Sunday Evanston passage. Many pages
remain uncertain, inaccessible, or budget-deferred; this rollout does not promise full
coverage or a poster for every event.
