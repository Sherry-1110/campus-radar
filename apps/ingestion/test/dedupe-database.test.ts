import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

for (const compact of [false, true]) test(`cross-source reconciliation preserves identities (${compact ? 'compact live format' : 'migration format'})`, async t => {
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
      let before = ''
      if (compact && file.endsWith('_conservative_occurrence_dedupe.sql')) {
        const original = (await db.query<{definition:string}>("select pg_get_functiondef('private.sync_source_events(text,jsonb,uuid)'::regprocedure) as definition")).rows[0]!.definition
        const minified = original.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').replaceAll('\\s', '\\' + '\\s')
        await db.exec(minified)
        before = (await db.query<{definition:string}>("select pg_get_functiondef('private.sync_source_events(text,jsonb,uuid)'::regprocedure) as definition")).rows[0]!.definition
      }
      await db.exec(await readFile(new URL(file, migrations), 'utf8'))
      if (before) {
        const after = (await db.query<{definition:string}>("select pg_get_functiondef('private.sync_source_events(text,jsonb,uuid)'::regprocedure) as definition")).rows[0]!.definition
        const start = before.indexOf('if v_id is null then select e.id')
        const end = before.indexOf('if v_id is null then insert into public.events')
        assert.ok(start > 0 && end > start)
        assert.ok(after.startsWith(before.slice(0, start)), 'Identity and validation logic must remain byte-for-byte unchanged')
        assert.ok(after.endsWith(before.slice(end)), 'Reconciliation and manual-edit logic must remain byte-for-byte unchanged')
      }
    }

    const candidate = (id: string, extra: Record<string, unknown> = {}, related_url: string | null = null) => ({ external_id: id, related_url, data: {
      title: 'Jazz: After Dark', description: 'Source description', cover_image_url: null,
      start_time: '2026-11-05T01:30:00Z', end_time: null, location: 'Music Box Theatre', location_url: null,
      is_free: false, fee_text: null, category: 'arts', is_cancelled: false, is_all_day: false,
      source_url: `https://calendar.example/events/${id}`, ...extra,
    } })
    const sync = async (item: unknown, source = 'Choose Chicago') => {
      await db.exec('set role service_role')
      try {
        const run = (await db.query<{id: string}>('select public.begin_source_sync($1,null) as id', [source])).rows[0]!.id
        const result = (await db.query<{result: {inserted: number;linked: number;updated:number}}>('select public.sync_source_events($1,$2::jsonb,$3) as result', [source, JSON.stringify([item]), run])).rows[0]!.result
        await db.query("select public.finish_source_sync($1,'succeeded',$2::jsonb)", [run, JSON.stringify(result)])
        return result
      } finally { await db.exec('reset role') }
    }
    const count = async () => (await db.query<{n:number}>('select count(*)::int as n from public.events')).rows[0]!.n
    const isolated = async (name: string, run: () => Promise<void>) => t.test(name, async () => {
      await db.exec('begin')
      try { await run() } finally { await db.exec('rollback') }
    })
    await isolated('title and venue punctuation normalize; organizer takes precedence while curator edits survive', async () => {
      await sync(candidate('a'))
      const id = (await db.query<{id:string}>('select id from events')).rows[0]!.id
      await db.query("update events set description='Curator description' where id=$1", [id])
      assert.equal((await sync(candidate('b', { title: 'Jazz — After Dark', location: 'Music-Box Theatre', description: 'Organizer description' }), 'Bienen School of Music')).linked, 1)
      assert.equal(await count(), 1)
      const event = (await db.query<{id:string;description:string;source:string}>('select e.id,e.description,s.name as source from events e join sources s on s.id=e.source_id')).rows[0]!
      assert.equal(event.id, id)
      assert.equal(event.description, 'Curator description')
      assert.equal(event.source, 'Bienen School of Music')
      await sync(candidate('b', { title: 'Rescheduled title', start_time: '2026-11-06T01:30:00Z', location: 'Another room' }), 'Bienen School of Music')
      assert.equal(await count(), 1)
      assert.equal((await db.query<{id:string}>('select id from events')).rows[0]!.id, id)
    })
    await isolated('organizer URL normalizes tracking, fragment, host and slash without needing a guessed venue', async () => {
      await sync(candidate('a', { location: null }, 'https://WWW.organizer.example/Show/?utm_source=email&event=42#tickets'))
      assert.equal((await sync(candidate('b', { title: 'Organizer title', location: null, source_url: 'https://organizer.example/Show?event=42&fbclid=abc' }), 'Bienen School of Music')).linked, 1)
      assert.equal(await count(), 1)
    })
    await isolated('different showtimes and meaningful query identities remain distinct', async () => {
      await sync(candidate('a', { location: null, source_url: 'https://organizer.example/show?id=42' }))
      await sync(candidate('b', { location: null, source_url: 'https://organizer.example/show?id=43' }), 'Bienen School of Music')
      await sync(candidate('c', { location: null, start_time: '2026-11-05T03:30:00Z', source_url: 'https://organizer.example/show?id=42' }), 'Bienen School of Music')
      assert.equal(await count(), 3)
    })
    await isolated('unknown and generic venues cannot match by title alone', async () => {
      for (const location of [null, 'TBA', 'Chicago']) {
        const suffix = String(location)
        await sync(candidate(`a-${suffix}`, { title: `Show ${suffix}`, location }))
        assert.equal((await sync(candidate(`b-${suffix}`, { title: `Show ${suffix}`, location }), 'Bienen School of Music')).inserted, 1)
      }
      assert.equal(await count(), 6)
    })
    await isolated('same-source occurrence IDs and ambiguous cross-source matches remain separate', async () => {
      await sync(candidate('a'))
      await sync(candidate('b'))
      assert.equal(await count(), 2)
      assert.equal((await sync(candidate('c'), 'Bienen School of Music')).inserted, 1)
      assert.equal(await count(), 3)
      await sync(candidate('a', { description: 'Updated known occurrence' }))
      assert.equal(await count(), 3)
    })
    await isolated('shared city, date and upcoming listings are not organizer occurrence identities', async () => {
      const listings = ['/?lang=en', '/?ref=do312', '/calendar?lang=en', '/upcoming-events/', '/all-shows', '/shows/chicago/', '/events/2026/10/5', '/calendar/month/2026-10-05', '/events?page=2']
      for (const [index, listing] of listings.entries()) {
        const related = `https://organizer.example${listing}`
        await sync(candidate(`listing-a-${index}`, { title: `Concert ${index}`, location: `Room A ${index}` }, related))
        assert.equal((await sync(candidate(`listing-b-${index}`, { title: `Comedy ${index}`, location: `Room B ${index}` }, related), 'Bienen School of Music')).inserted, 1)
      }
      assert.equal(await count(), listings.length * 2)
    })
    await isolated('shared homepage and distinct known venues do not imply a duplicate', async () => {
      await sync(candidate('a', { location: 'Room A' }, 'https://organizer.example/'))
      await sync(candidate('b', { location: 'Room B' }, 'https://organizer.example/?utm_source=email'), 'Bienen School of Music')
      assert.equal(await count(), 2)
    })
  } finally { await db.close() }
})
