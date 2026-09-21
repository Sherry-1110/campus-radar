import assert from 'node:assert/strict'
import { test } from 'node:test'
import { eventSource } from '../src/lib/eventSource.ts'

test('shows only the original source, retaining the listing as a fallback', () => {
  const listings = [{ source_url: 'https://www.choosechicago.com/event/dinos/', sources: { name: 'Choose Chicago', url: 'https://www.choosechicago.com' } }]
  assert.deepEqual(eventSource({ source_url: 'https://www.brookfieldzoo.org/events/dinos', event_sources: listings }), {
    url: 'https://www.brookfieldzoo.org/events/dinos', name: 'brookfieldzoo.org',
  })
  assert.deepEqual(eventSource({ source_url: null, event_sources: listings }), {
    url: listings[0].source_url, name: 'Choose Chicago',
  })
  assert.equal(eventSource({ source_url: null, event_sources: [] }), null)
})
