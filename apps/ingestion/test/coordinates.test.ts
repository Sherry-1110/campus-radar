import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseGeocoding } from '../src/coordinates.ts'

const result = { placeId: 'test-place', granularity: 'ROOFTOP', types: ['street_address'], postalAddress: { regionCode: 'US' }, location: { latitude: 42.05, longitude: -87.67 } }

test('geocoding accepts a precise unique venue but rejects partial, broad and ambiguous results', () => {
  assert.deepEqual(parseGeocoding({ results: [result] }), { latitude: 42.05, longitude: -87.67, place_id: 'test-place' })
  for (const rows of [[{ ...result, granularity: 'APPROXIMATE' }], [{ ...result, granularity: 'RANGE_INTERPOLATED' }], [result, result], [{ ...result, types: ['locality'] }], [{ ...result, location: { latitude: 100, longitude: -87 } }]]) {
    assert.equal(parseGeocoding({ results: rows }), null)
  }
  assert.equal(parseGeocoding({ results: [] }), null)
  assert.throws(() => parseGeocoding({ error: { status: 'PERMISSION_DENIED' } }), /PERMISSION_DENIED/)
})

// Regression: repeated ingestion must reuse stored coordinates, including across occurrences.
test('ingestion saves shared venue coordinates, reuses them on reruns, and refreshes stale locations', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const { syncCoordinates } = await import('../src/coordinates.ts')
  const now = new Date('2026-10-03T18:00:00Z')
  const events = [
    { id: 'one', location: 'Venue', region: 'chicago' },
    { id: 'two', location: 'Venue', region: 'chicago' },
    { id: 'online', location: 'Online', region: 'chicago' },
    { id: 'unresolved', location: 'Ambiguous', region: 'chicago' },
  ]
  let stored: Record<string, unknown>[] = []
  let writes = 0, lookups = 0
  const client = createClient('https://example.supabase.co', 'backend-test-key', { auth: { persistSession: false }, global: { fetch: async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/events')) {
      assert.equal(url.searchParams.get('start_time'), 'gte.2026-10-03T05:00:00.000Z', 'include today’s all-day events')
      assert.equal(url.searchParams.get('order'), 'start_time.asc,id.asc', 'prioritize upcoming venues')
      return Response.json(events)
    }
    assert.ok(url.pathname.endsWith('/event_coordinates'))
    if (init?.method === 'DELETE') {
      stored = stored.filter(row => String(row.expires_at) > now.toISOString())
      return new Response(null, { status: 204 })
    }
    if (init?.method === 'POST') {
      const rows = JSON.parse(String(init.body)) as Record<string, unknown>[]
      for (const row of rows) { stored = stored.filter(old => old.event_id !== row.event_id); stored.push(row); writes++ }
      return new Response(null, { status: 201 })
    }
    return Response.json(stored)
  } } })
  const locate = async (address: string) => { lookups++; return address.startsWith('Ambiguous') ? null : { latitude: 42.05, longitude: -87.67, place_id: 'venue' } }
  const options = { apply: true, limit: 10, key: 'demo-test-key', now }
  const preview = await syncCoordinates(client, { ...options, apply: false }, locate)
  assert.equal(preview.address_requests, 2); assert.equal(writes, 0); assert.equal(lookups, 0)
  const first = await syncCoordinates(client, options, locate)
  assert.equal(first.located, 2); assert.equal(first.unresolved, 2)
  assert.equal(lookups, 2); assert.equal(writes, 2)
  assert.equal(stored[0].expires_at, '2026-11-01T18:00:00.000Z')
  events.push({ id: 'three', location: 'Venue', region: 'chicago' })
  await syncCoordinates(client, options, locate)
  assert.equal(lookups, 3, 'only the unresolved venue is retried')
  assert.equal(writes, 3, 'only the new occurrence needs a coordinate write')
  stored.forEach(row => { row.expires_at = '2026-10-04T06:00:00Z' })
  await syncCoordinates(client, options, locate)
  assert.equal(lookups, 5, 'refresh once per venue before expiry')
  events[0].location = 'Changed venue'
  await syncCoordinates(client, options, locate)
  assert.equal(stored.find(row => row.event_id === 'one')?.coordinate_location, 'Changed venue')
  const limited = await syncCoordinates(client, { ...options, limit: 1 }, async () => { throw new Error('Google Geocoding HTTP 429') })
  assert.equal(limited.located, 3, 'quota failure retains existing pins')
  assert.equal(limited.warning, 'Google Geocoding HTTP 429')
  assert.equal(limited.deferred, 1)
})

test('transient geocoding throttling retries instead of abandoning the backfill', async () => {
  const { geocodeVenue } = await import('../src/coordinates.ts')
  const originalFetch = globalThis.fetch
  let attempts = 0
  globalThis.fetch = async (_url, init) => {
    assert.equal(init?.redirect, 'manual')
    return ++attempts === 1 ? new Response('', { status: 429 }) : Response.json({ results: [result] })
  }
  try {
    assert.equal((await geocodeVenue('Venue, Chicago, IL', 'test-key'))?.place_id, 'test-place')
    assert.equal(attempts, 2)
  } finally { globalThis.fetch = originalFetch }
})

test('daily quota exhaustion stops without retrying until the next ingestion run', async () => {
  const { geocodeVenue } = await import('../src/coordinates.ts')
  const originalFetch = globalThis.fetch
  let attempts = 0
  globalThis.fetch = async () => {
    attempts++
    return Response.json({ error: { details: [{ metadata: { quota_unit: '1/d/{project}' } }] } }, { status: 429 })
  }
  try {
    await assert.rejects(geocodeVenue('Venue, Chicago, IL', 'test-key'), /daily quota reached/)
    assert.equal(attempts, 1)
  } finally { globalThis.fetch = originalFetch }
})

test('Census backfills without a Google key and continues after Google exhausts its quota', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const { syncCoordinates } = await import('../src/coordinates.ts')
  const originalFetch = globalThis.fetch
  const saved: Record<string, unknown>[] = []
  let googleCalls = 0
  globalThis.fetch = async input => {
    const url = new URL(String(input))
    if (url.hostname === 'example.supabase.co') {
      return Response.json(url.pathname.endsWith('/events') ? [
        { id: 'unknown', location: 'Unknown venue', region: 'chicago' },
        { id: 'known', location: 'Venue, 1363 W Ohio St, Chicago, IL, 60642', region: 'chicago' },
        { id: 'another-unknown', location: 'Another venue', region: 'chicago' },
      ] : [])
    }
    if (url.hostname === 'geocode.googleapis.com') {
      googleCalls++
      return Response.json({ error: { details: [{ metadata: { quota_unit: '1/d/{project}' } }] } }, { status: 429 })
    }
    assert.equal(url.hostname, 'geocoding.geo.census.gov')
    return Response.json({ result: { addressMatches: [{ matchedAddress: '1363 W OHIO ST, CHICAGO, IL, 60642', addressComponents: { state: 'IL', zip: '60642' }, coordinates: { x: -87.661893, y: 41.892436 } }] } })
  }
  const client = createClient('https://example.supabase.co', 'backend-test-key', { auth: { persistSession: false }, global: { fetch: async (input, init) => {
    if (init?.method === 'POST') { saved.push(...JSON.parse(String(init.body))); return new Response(null, { status: 201 }) }
    if (init?.method === 'DELETE') return new Response(null, { status: 204 })
    return globalThis.fetch(input, init)
  } } })
  try {
    const noKey = await syncCoordinates(client, { apply: true, limit: 10 })
    assert.equal(noKey.located, 1); assert.equal(googleCalls, 0)
    const withKey = await syncCoordinates(client, { apply: true, limit: 10, key: 'test-key' })
    assert.equal(withKey.located, 1); assert.equal(googleCalls, 1)
    assert.equal(withKey.warning, '')
    assert.match(withKey.google_warning, /daily quota/)
    assert.equal(saved[0].provider, 'census'); assert.equal(saved[0].place_id, null)
    assert.equal(saved[0].matched_address, '1363 W OHIO ST, CHICAGO, IL, 60642')
  } finally { globalThis.fetch = originalFetch }
})
