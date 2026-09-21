-- Short-lived Google coordinates; activation requires an approved cleanup schedule.
create table public.event_coordinates (
  event_id uuid primary key references public.events(id) on delete cascade,
  coordinate_location text not null,
  address_query text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  place_id text not null,
  expires_at timestamptz not null check (expires_at <= now() + interval '30 days')
);
create index event_coordinates_expiry_idx on public.event_coordinates(expires_at);
create index event_coordinates_address_idx on public.event_coordinates(address_query);
alter table public.event_coordinates enable row level security;
grant select on public.event_coordinates to anon, authenticated;
grant all on public.event_coordinates to service_role;
create policy coordinates_published on public.event_coordinates for select to anon, authenticated
using (expires_at > now() and exists (
  select 1 from public.events e where e.id=event_id and e.status='published' and e.location=coordinate_location
));

create function private.clear_changed_coordinates() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  delete from public.event_coordinates where event_id=new.id;
  return new;
end;
$$;
revoke all on function private.clear_changed_coordinates() from public, anon, authenticated;
create trigger events_clear_changed_coordinates after update of location on public.events
for each row when (old.location is distinct from new.location)
execute function private.clear_changed_coordinates();

create function private.validate_coordinate_location() returns trigger
language plpgsql set search_path='' as $$
begin
  perform 1 from public.events where id=new.event_id and location=new.coordinate_location for share;
  if not found then raise exception 'Event location changed; rerun coordinate lookup'; end if;
  return new;
end;
$$;
revoke all on function private.validate_coordinate_location() from public, anon, authenticated;
create trigger coordinates_validate_location before insert or update on public.event_coordinates
for each row execute function private.validate_coordinate_location();
