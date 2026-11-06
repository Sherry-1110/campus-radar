import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchSpace } from '../src/sources/space.ts'

// Public widget branch shape as of 2026-11-06; keys replaced with test values.
const widget = `if (venue === 'thalia') {
  tmUrl = 'https://app.ticketmaster.com/discovery/v2/events.json?venueId=thalia';
} else if (venue === 'space' || venue === 'space-presents') {
  tmUrl = 'https://app.ticketmaster.com/discovery/v2/events.json?size=200&apikey=public-example&venueId=space,cahn';
  tmUrl2 = 'https://app.ticketmaster.com/discovery/v2/events.json?size=200&apikey=public-example&promoterId=6085';
} else if (venue === 'cahn') {
  tmUrl = 'https://app.ticketmaster.com/discovery/v2/events.json?venueId=cahn';
}`
const event = (id: string) => ({ id, name: 'Concert', url: 'https://www.ticketweb.com/event/concert/123', dates: { start: { dateTime: '2026-11-07T01:30:00Z' } } })
const feed = (ids: string[], number = 0, totalPages = 1, totalElements = ids.length) => JSON.stringify({ _embedded: { events: ids.map(event) }, page: { number, totalPages, totalElements, size: 200 } })

test('SPACE drains the two published feeds in the shared widget branch without requesting the retired feed', async () => {
  const result = await fetchSpace(async href => {
    if (href.endsWith('event-feed-widget.js')) return widget
    const params = new URL(href).searchParams
    if (params.get('venueId') === 'space,cahn') return feed(['venue-event'])
    if (params.get('promoterId') === '6085') return params.get('page') === '1' ? feed(['promoter-2'], 1, 2, 2) : feed(['promoter-1'], 0, 2, 2)
    throw new Error('Unexpected feed requested')
  })
  assert.deepEqual(result.items.map(item => item.external_id), ['tm:venue-event', 'tm:promoter-1', 'tm:promoter-2'])
})

test('SPACE still rejects untrusted endpoints and repeated pages in the shared widget branch', async () => {
  await assert.rejects(fetchSpace(async href => {
    assert.ok(href.endsWith('event-feed-widget.js'), 'invalid configuration must fail before a feed request')
    return widget.replace('https://app.ticketmaster.com', 'https://evil.example')
  }), /configuration/)
  await assert.rejects(fetchSpace(async href => {
    if (href.endsWith('event-feed-widget.js')) return widget
    return feed(['repeated'], Number(new URL(href).searchParams.get('page')), 2, 2)
  }), /repeated pagination/)
})
