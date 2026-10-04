-- A new enum value cannot be used in the transaction that adds it, so the
-- classifier and backfill that use it live in the next migration.
alter type public.event_category add value if not exists 'market';
