-- Hand-picked events for the home page poster strip: 1 shows first. Null leaves the choice to the automatic picker.
-- ponytail: set by SQL for now; add an admin screen if picking becomes a routine job.
alter table public.events add column featured_rank smallint check (featured_rank > 0);
