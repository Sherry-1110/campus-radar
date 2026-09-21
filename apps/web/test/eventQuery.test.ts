import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/lib/database.types.ts'
import { DEFAULT_FILTERS } from '../src/lib/filters.ts'
import { queryEvents } from '../src/lib/eventQuery.ts'

test('bounds and category restrictions reach the database before pagination', async () => {
  let requested = ''
  const client = createClient<Database>('https://example.supabase.co', 'public-test-key', {
    auth: { persistSession: false }, global: { fetch: async input => {
      requested = String(input)
      return new Response('[]', { headers: { 'content-type': 'application/json' } })
    } },
  })
  await queryEvents(client, DEFAULT_FILTERS, 'id', { south: 41, west: -88, north: 43, east: -87 }).range(12, 23)
  const params = new URL(requested).searchParams
  assert.match(params.get('select')!, /event_coordinates!inner/)
  assert.equal(params.get('event_coordinates.latitude'), 'gte.41')
  assert.deepEqual(params.getAll('event_coordinates.latitude'), ['gte.41', 'lte.43'])
  assert.ok(!params.get('category')?.includes('academic'))
  assert.equal(params.get('offset'), '12')
})
