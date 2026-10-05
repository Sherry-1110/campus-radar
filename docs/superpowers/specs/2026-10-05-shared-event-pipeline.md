# Shared event pipeline

Approved in chat: expand to Cats on Campus, Downtown Evanston, SPACE, Do312, Music Box and Second City, using per-source raw storage and shared standardization, deduplication and enrichment. Do not prioritize free/student events. Preserve separate dates/showtimes and publicly show the most original source.

Collectors keep original public response bodies in private source partitions before parsing. A common parent table and run-to-document manifest permit replay, including failed parser runs. Identical URL/body revisions are shared. Adapters receive a fixed collection clock and injected fetcher, so replay uses stored responses and cannot silently fall back to the network.

A private standardized source-event table stores normalized input, enriched output, stage/status, hashes, run and parser version, and canonical event ID. Existing events/event_sources remain canonical storage and provenance. Existing verified organizer enrichment, poster storage, coordinate and JEV category jobs are reused. A source run becomes publishable only after its complete candidate set is validated and staged. Batch publication stays atomic, repeatable and protected by existing source authority/manual edit checks.

Raw capture, standardization, enrichment and publication have durable run progress. Replaying a retained run re-parses source responses with its original clock; optional missing organizer pages fail closed. Changed input or parser version is reprocessed; identical normalized content can reuse previous verified enrichment. Metadata jobs retain their own input-keyed caches. Keep the most recent three raw run manifests per source (including failures); content blobs remain while referenced. This bounds retention and leaves replay/debugging for recent failures.

Deduplication extends the existing same-source ID/organizer URL/exact fingerprint matching with normalized event-specific URLs and conservative title+venue keys. Different dates/showtimes and generic homepages must not merge. Uncertain semantic matches remain separate; a fuzzy JEV merge requires its own evaluated evidence gate, not untested thresholds. This first release preserves raw provenance for later improvements and reports unresolved overlaps.

Sources are enabled only after actual feed/extraction verification. Failed/challenged access is reported honestly and never replaced with fabricated events. No source disappearance cancels an event. Backend-only grants protect raw/staged data. Existing event IDs and saved links survive migration.
