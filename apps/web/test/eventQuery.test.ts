import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/lib/database.types.ts'
import { DEFAULT_FILTERS } from '../src/lib/filters.ts'
import { queryEvents } from '../src/lib/eventQuery.ts'

test('filters and grouping reach the database before pagination', async () => {
  let requested = ''; let body: Record<string, unknown> = {}
  const client = createClient<Database>('https://example.supabase.co', 'public-test-key', {
    auth: { persistSession: false }, global: { fetch: async (input, init) => {
      requested = String(input); body = JSON.parse(String(init?.body))
      return new Response('[]', { headers: { 'content-type': 'application/json' } })
    } },
  })
  const bounds = { south: 41, west: -88, north: 43, east: -87 }
  await queryEvents(client, DEFAULT_FILTERS, { bounds }).range(12, 23)
  assert.match(new URL(requested).pathname, /rpc\/browse_events$/)
  assert.deepEqual(body.p_bounds, bounds)
  assert.equal(body.p_group, true)
  assert.equal(body.p_categories, undefined, 'All categories means no category filter')
  assert.ok(Array.isArray(body.p_ranges))
  assert.equal(new URL(requested).searchParams.get('offset'), '12')
  await queryEvents(client, DEFAULT_FILTERS, { ids: [], group: false })
  assert.deepEqual(body.p_ids, [])
  assert.equal(body.p_group, false)
})
