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
    const functions = await db.query("select 1 from pg_proc where proname = 'sync_source_events' and pronamespace='public'::regnamespace")
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
        const run = (await db.query<{ id: string }>('select public.begin_source_sync($1,null) as id', [source])).rows[0].id
        const result = await db.query<{ result: Stats }>('select public.sync_source_events($1, $2::jsonb, $3) as result', [source, JSON.stringify(items), run])
        await db.query("select public.finish_source_sync($1,'succeeded',$2::jsonb)", [run, JSON.stringify(result.rows[0].result)])
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

    // Health tracks whole-source attempts, not the last successful batch.
    await db.exec('set role service_role')
    const begin = async () => (await db.query<{ id: string }>("select public.begin_source_sync('PlanItPurple', null) as id")).rows[0].id
    const finish = (id: string, status: string, summary: object = {}) => db.query('select public.finish_source_sync($1,$2,$3::jsonb)', [id, status, JSON.stringify(summary)])
    const health = async () => (await db.query<{ status: string; last_success_at: string | null; error_code: string | null; candidates: number }>("select * from public.source_health where source_name='PlanItPurple'")).rows[0]
    const run1 = await begin()
    assert.equal((await health()).status, 'running')
    await finish(run1, 'succeeded', { candidates: 2, posters: 1, inserted: 2 })
    const successful = await health()
    assert.ok(successful.last_success_at)
    const run2 = await begin()
    await assert.rejects(finish(run1, 'failed'), /stale/i, 'Old jobs cannot overwrite a newer attempt')
    await assert.rejects(db.query('select public.sync_source_events($1,$2::jsonb,$3)', ['PlanItPurple', JSON.stringify([candidate]), run1]), /stale/i, 'Superseded runs cannot write event data')
    await finish(run2, 'failed', { error_code: 'fetch_failed' })
    assert.equal((await health()).status, 'failed')
    assert.deepEqual((await health()).last_success_at, successful.last_success_at)
    assert.equal((await health()).error_code, 'fetch_failed')
    const run3 = await begin()
    await assert.rejects(finish(run3, 'failed', { error_code: 'raw-secret-error' }), /check constraint/)
    await finish(run3, 'failed', { error_code: 'sync_failed' })
    await db.exec('reset role')
    const city = structuredClone(candidate)
    city.external_id = 'city-1'; city.data.title = 'City event'; city.data.source_url = 'https://www.choosechicago.com/event/test/'
    assert.equal((await sync([city], 'Choose Chicago')).inserted, 1)
    await assert.rejects(sync([city], 'Instagram (curated)'), /Unsupported|no rows/i)

    // Optional detail failures retain verified content while schedule/cancellation still update.
    const detailed = { ...structuredClone(city), external_id: 'detail-1', listing_url: 'https://www.choosechicago.com/event/details/', related_url: 'https://organizer.example/concert',
      enrichment: { status: 'enriched', fields: ['description','cover_image_url','source_url'], base: { description: 'Calendar note', cover_image_url: null, source_url: 'https://www.choosechicago.com/event/details/' }, chain: ['https://organizer.example/concert'] } }
    detailed.data.title='Detailed original event'; detailed.data.description='Verified original program';
    detailed.data.cover_image_url='https://organizer.example/poster.jpg'; detailed.data.source_url=detailed.related_url;
    await sync([detailed], 'Choose Chicago')
    const fallback=structuredClone(detailed)
    fallback.data.description='Calendar note'; fallback.data.cover_image_url=null as unknown as string;
    fallback.data.source_url=detailed.listing_url; fallback.data.is_cancelled=true;
    fallback.enrichment.status='unavailable'; fallback.enrichment.fields=[]; fallback.enrichment.chain=[];
    assert.equal((await sync([fallback], 'Choose Chicago')).updated,1)
    const recovered=(await db.query<{description:string;cover_image_url:string;source_url:string;is_cancelled:boolean}>("select * from events where title='Detailed original event'")).rows[0]
    assert.equal(recovered.description,detailed.data.description)
    assert.equal(recovered.cover_image_url,detailed.data.cover_image_url)
    assert.equal(recovered.source_url,detailed.related_url)
    assert.equal(recovered.is_cancelled,true)
    assert.equal((await sync([fallback], 'Choose Chicago')).unchanged,1)
    fallback.enrichment.status='enriched'; fallback.enrichment.fields=['source_url']; fallback.data.source_url=detailed.related_url;
    await sync([fallback], 'Choose Chicago')
    assert.equal((await db.query<{cover_image_url:string}>("select cover_image_url from events where title='Detailed original event'")).rows[0].cover_image_url,detailed.data.cover_image_url,'A valid page without artwork must not erase a previously verified image')
    assert.equal((await db.query<{source_url:string}>("select source_url from event_sources where external_id='detail-1'")).rows[0].source_url,detailed.listing_url)

    // Backfill must update the baseline, so later syncs can still replace posters.
    const remote = detailed.data.cover_image_url
    const stored = 'https://project.supabase.co/storage/v1/object/public/event-posters/imported/' + 'a'.repeat(64) + '.webp'
    const path = 'imported/' + 'a'.repeat(64) + '.webp'
    await db.query("insert into storage.objects(bucket_id,name) values ('event-posters',$1)", [path])
    await db.exec('set role service_role')
    await db.query('select public.remember_event_poster($1,$2,$3)', [remote,path,stored])
    await db.exec('reset role')
    const poster = async () => (await db.query<{cover_image_url:string}>("select cover_image_url from events where title='Detailed original event'")).rows[0].cover_image_url
    assert.equal(await poster(),stored)
    await sync([detailed], 'Choose Chicago')
    assert.equal(await poster(),stored,'An unchanged remote URL must resolve to its stored copy')
    detailed.data.cover_image_url='https://organizer.example/new.jpg'
    await sync([detailed], 'Choose Chicago')
    assert.equal(await poster(),stored,'An unavailable replacement must preserve the stored poster')
    const nextPath='imported/'+'b'.repeat(64)+'.webp', nextStored=stored.replace('a'.repeat(64),'b'.repeat(64))
    await db.query("insert into storage.objects(bucket_id,name) values ('event-posters',$1)", [nextPath])
    await db.exec('set role service_role')
    await db.query('select public.remember_event_poster($1,$2,$3)', [detailed.data.cover_image_url,nextPath,nextStored])
    await db.exec('reset role')
    await sync([detailed], 'Choose Chicago')
    assert.equal(await poster(),nextStored,'A successful replacement must still update after backfill')
    await db.query("update events set cover_image_url='https://curator.example/custom.jpg' where title='Detailed original event'")
    detailed.data.cover_image_url=remote
    await sync([detailed], 'Choose Chicago')
    assert.equal(await poster(),'https://curator.example/custom.jpg','Keep curator changes')
    await assert.rejects(db.query('select public.remember_event_poster($1,$2,$3)', [remote,'imported/'+'c'.repeat(64)+'.webp',stored]), /uploaded|storage/i)

    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      await assert.rejects(db.query('select public.sync_source_events($1,$2::jsonb,$3)', ['PlanItPurple', JSON.stringify([candidate]), run3]), /permission denied/)
      await assert.rejects(db.query('select * from private.ingestion_items'), /permission denied/)
      await assert.rejects(db.query('select public.get_event_poster_copies($1)', [[remote]]), /permission denied/)
      await assert.rejects(db.query('select public.remember_event_poster($1,$2,$3)', [remote,path,stored]), /permission denied/)
      assert.equal((await health()).status, 'failed', 'Public can read safe health')
      await assert.rejects(db.query("select public.begin_source_sync('PlanItPurple',null)"), /permission denied/)
      await assert.rejects(db.query("update public.source_health set status='succeeded'"), /permission denied/)

      await db.exec('reset role')
    }

  } finally { await db.close() }
})
