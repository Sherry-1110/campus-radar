import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

test('nightly reconciliation is atomic, idempotent, respects edits, and is service-only', async () => {
  const db = new PGlite({ extensions: { pg_trgm } })
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage; create schema extensions;
      create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public, auth, storage to anon, authenticated, service_role;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;
      grant all on storage.objects to authenticated, service_role;
      create function storage.foldername(name text) returns text[] language sql immutable as $$
        select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
    `)
    const migrations = new URL('../../../supabase/migrations/', import.meta.url)
    for (const file of (await readdir(migrations)).filter(f => f.endsWith('.sql')).sort()) {
      await db.exec(await readFile(new URL(file, migrations), 'utf8'))
    }
    const functions = await db.query("select 1 from pg_proc where proname = 'sync_source_events'")
    assert.equal(functions.rows.length, 1, 'The service-only nightly sync RPC must exist')

    // These existing checks require a fresh database with no imported events.
    await db.exec(await readFile(new URL('../../../supabase/tests/regressions.sql', import.meta.url), 'utf8'))

    const candidate = {
      external_id: '123', related_url: null as string | null,
      data: {
        title: 'Student concert', description: 'Original program',
        cover_image_url: 'https://www.music.northwestern.edu/poster.jpg',
        start_time: '2026-11-05T01:30:00.000Z', end_time: null,
        location: 'Pick-Staiger', location_url: null, is_free: true, fee_text: 'Free',
        category: 'music', is_cancelled: false, is_all_day: false,
        source_url: 'https://planitpurple.northwestern.edu/event/123',
      },
    }
    type Stats = { inserted: number; updated: number; unchanged: number; linked: number; conflicts: number }
    const sync = async (items: unknown[], source = 'PlanItPurple') => {
      await db.exec('set role service_role')
      try {
        const result = await db.query<{ result: Stats }>('select public.sync_source_events($1, $2::jsonb) as result', [source, JSON.stringify(items)])
        return result.rows[0].result
      } finally { await db.exec('reset role') }
    }
    const event = async () => (await db.query<{ id: string; title: string; description: string; start_time: Date; is_cancelled: boolean; status: string; updated_at: Date }>('select * from events order by created_at limit 1')).rows[0]
    assert.equal((await sync([candidate])).inserted, 1)
    const first = await event()
    assert.equal(first.status, 'published')
    assert.equal((await sync([candidate])).unchanged, 1)
    assert.deepEqual(await event(), first, 'Unchanged run must not rewrite any event field, including updated_at')

    candidate.data.start_time = '2026-11-06T01:30:00.000Z'
    candidate.data.description = 'New program'
    candidate.data.is_cancelled = true
    assert.equal((await sync([candidate])).updated, 1)
    const changed = await event()
    assert.equal(changed.id, first.id, 'Rescheduling must preserve event identity')
    assert.equal(changed.is_cancelled, true)
    assert.equal(changed.description, 'New program')
    assert.equal(new Date(changed.start_time).toISOString(), candidate.data.start_time)

    await db.query("update events set description='Curator correction', status='rejected' where id=$1", [first.id])
    candidate.data.description = 'Another source update'
    candidate.data.title = 'Revised concert title'
    candidate.data.is_cancelled = false
    const corrected = await sync([candidate])
    assert.equal(corrected.updated, 1)
    assert.equal(corrected.conflicts, 1)
    assert.equal((await event()).description, 'Curator correction')
    assert.equal((await event()).title, 'Revised concert title')
    assert.equal((await event()).status, 'rejected', 'Do not republish curator-rejected records')
    assert.equal((await event()).is_cancelled, false, 'Explicit reinstatement must be reflected')
    const stable = await event()
    assert.equal((await sync([candidate])).unchanged, 1)
    assert.deepEqual(await event(), stable)

    const duplicate = structuredClone(candidate)
    duplicate.external_id = 'bienen-1'
    duplicate.data.source_url = 'https://www.music.northwestern.edu/events/concert'
    duplicate.related_url = candidate.data.source_url
    assert.equal((await sync([duplicate], 'Bienen School of Music')).linked, 1)
    assert.equal((await db.query('select * from events')).rows.length, 1)
    assert.equal((await db.query('select * from event_sources')).rows.length, 2)

    duplicate.data.is_cancelled = true
    duplicate.data.start_time = '2026-11-07T01:30:00.000Z'
    assert.equal((await sync([duplicate], 'Bienen School of Music')).updated, 1)
    assert.equal((await event()).is_cancelled, true, 'Organizer cancellation must override an older shared calendar listing')
    assert.equal(new Date((await event()).start_time).toISOString(), duplicate.data.start_time)
    candidate.data.title = 'Outdated shared listing'
    await sync([candidate])
    assert.equal((await event()).is_cancelled, true, 'Secondary source must not undo authoritative cancellation')
    duplicate.data.is_cancelled = false
    await sync([duplicate], 'Bienen School of Music')
    const afterAuthority = await event()

    // A source failure/empty snapshot cannot erase or cancel anything.
    await assert.rejects(sync([]), /empty/i)
    assert.deepEqual(await event(), afterAuthority)
    const second = structuredClone(candidate)
    second.external_id = '456'; second.data.title = 'Second concert'
    second.data.source_url = 'https://planitpurple.northwestern.edu/event/456'
    const invalid = structuredClone(second)
    invalid.external_id = '789'; invalid.data.start_time = 'invalid'
    await assert.rejects(sync([second, invalid]))
    assert.equal((await db.query('select * from events')).rows.length, 1, 'Invalid batch must roll back its earlier inserts')
    assert.equal((await sync([second])).inserted, 1)
    assert.equal((await event()).is_cancelled, false, 'Absence in a later snapshot is not cancellation')

    await db.query("delete from private.ingestion_items where external_id='456'")
    second.data.is_cancelled = true
    second.data.is_all_day = true
    await sync([second])
    const legacy = await db.query<{ is_cancelled: boolean; is_all_day: boolean }>("select is_cancelled,is_all_day from events where source_url=$1", [second.data.source_url])
    assert.equal(legacy.rows[0].is_cancelled, true, 'First snapshot must bootstrap lifecycle for existing imports')
    assert.equal(legacy.rows[0].is_all_day, true)
    assert.equal((await sync([second])).unchanged, 1)

    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      await assert.rejects(db.query('select public.sync_source_events($1,$2::jsonb)', ['PlanItPurple', JSON.stringify([candidate])]), /permission denied/)
      await assert.rejects(db.query('select * from private.ingestion_items'), /permission denied/)
      await db.exec('reset role')
    }

  } finally { await db.close() }
})
