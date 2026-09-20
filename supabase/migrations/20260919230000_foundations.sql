-- Extensions, enums, and shared helpers.

create extension if not exists pg_trgm with schema extensions;

-- Non-exposed schema for helper/trigger functions. The Data API only serves
-- `public`, so nothing here is callable as an RPC.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create type public.event_status as enum ('draft', 'pending_review', 'published', 'rejected');
create type public.source_type as enum ('calendar_scrape', 'social_manual', 'user_upload', 'eventbrite_api');
create type public.user_role as enum ('student', 'curator', 'admin');
create type public.review_status as enum ('pending', 'approved', 'rejected');
create type public.event_category as enum (
  'arts', 'music', 'sports', 'academic', 'career', 'social', 'wellness', 'food', 'other'
);

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
