-- A new enum value cannot be used in the transaction that adds it.
alter type public.event_category add value if not exists 'performance';
