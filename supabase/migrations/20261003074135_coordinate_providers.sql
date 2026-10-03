-- Preserve the existing lifetime and location-invalidation rules for all providers.
alter table public.event_coordinates
  add column provider text not null default 'google' check (provider in ('google','census')),
  add column matched_address text,
  alter column place_id drop not null,
  add constraint coordinates_provider_identity check (
    (provider='google' and place_id is not null) or
    (provider='census' and matched_address is not null)
  );
comment on column public.event_coordinates.provider is 'Google venue coordinates or Census street-interpolated coordinates.';
