-- Core tables. Access rules (grants + RLS) live in the next migration.

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  email_domain text,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 80),
  school_id uuid references public.schools (id),
  role public.user_role not null default 'student',
  is_school_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  type public.source_type not null,
  url text check (url is null or url ~* '^https?://'),
  fetch_interval interval not null default '1 day',
  last_fetched_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id),
  title text not null check (char_length(title) between 1 and 200),
  description text check (description is null or char_length(description) <= 5000),
  cover_image_url text check (cover_image_url is null or cover_image_url ~* '^https?://'),
  start_time timestamptz not null,
  end_time timestamptz,
  location text check (location is null or char_length(location) <= 300),
  location_url text check (location_url is null or location_url ~* '^https?://'),
  is_free boolean not null default false,
  fee_text text check (fee_text is null or char_length(fee_text) <= 100),
  category public.event_category not null default 'other',
  tags text[] not null default '{}',
  status public.event_status not null default 'pending_review',
  source_id uuid references public.sources (id) on delete set null,
  source_url text check (source_url is null or source_url ~* '^https?://'),
  created_by uuid references public.profiles (id) on delete set null,
  -- Exact-duplicate backstop: normalized title + start minute. Fuzzy matching
  -- happens in the ingestion layer; this only stops identical rows.
  dedupe_key text generated always as (
    md5(
      regexp_replace(lower(title), '[\s[:punct:]]+', '', 'g')
      || '|' || floor(extract(epoch from (start_time at time zone 'UTC')) / 60)::bigint::text
    )
  ) stored,
  search tsvector generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(location, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time is null or end_time >= start_time)
);

create unique index events_school_dedupe_key_idx on public.events (school_id, dedupe_key);
create index events_status_start_time_idx on public.events (status, start_time);
create index events_created_by_idx on public.events (created_by);
create index events_search_idx on public.events using gin (search);
create index events_title_trgm_idx on public.events using gin (title extensions.gin_trgm_ops);
create index events_tags_idx on public.events using gin (tags);

-- Every source that has reported an event (provenance), so dedupe merges
-- instead of discarding.
create table public.event_sources (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  source_id uuid not null references public.sources (id) on delete cascade,
  external_id text,
  source_url text check (source_url is null or source_url ~* '^https?://'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (source_id, external_id)
);

create index event_sources_event_id_idx on public.event_sources (event_id);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.events (id) on delete cascade,
  submitted_by uuid not null references public.profiles (id) on delete cascade,
  review_status public.review_status not null default 'pending',
  reviewer_notes text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index submissions_submitted_by_idx on public.submissions (submitted_by);
create index submissions_review_status_idx on public.submissions (review_status);

create table public.mailing_list_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  frequency text not null default 'weekly' check (frequency in ('daily', 'weekly')),
  categories public.event_category[] not null default '{}',
  confirmed_at timestamptz,
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now()
);

create unique index mailing_list_subscribers_email_idx on public.mailing_list_subscribers (lower(email));

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger sources_set_updated_at before update on public.sources
  for each row execute function private.set_updated_at();
create trigger events_set_updated_at before update on public.events
  for each row execute function private.set_updated_at();
create trigger submissions_set_updated_at before update on public.submissions
  for each row execute function private.set_updated_at();

-- Profile creation + school verification. Verification requires a confirmed
-- email whose domain (or subdomain) matches a school's email_domain, so a
-- typed-in @northwestern.edu address alone proves nothing.
create function private.handle_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain text := lower(split_part(coalesce(new.email, ''), '@', 2));
  v_school_id uuid;
begin
  select s.id into v_school_id
  from public.schools s
  where s.email_domain is not null
    and (v_domain = s.email_domain or v_domain like ('%.' || s.email_domain))
  limit 1;

  insert into public.profiles (id, school_id, is_school_verified)
  values (new.id, v_school_id, v_school_id is not null and new.email_confirmed_at is not null)
  on conflict (id) do update
    set school_id = excluded.school_id,
        is_school_verified = excluded.is_school_verified;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_auth_user();

create trigger on_auth_user_updated
  after update of email, email_confirmed_at on auth.users
  for each row
  when (old.email is distinct from new.email or old.email_confirmed_at is distinct from new.email_confirmed_at)
  execute function private.handle_auth_user();
