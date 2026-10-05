import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchSpace, parseSpace } from '../src/sources/space.ts'
import { fetchDo312, parseDo312 } from '../src/sources/do312.ts'
const event = (extra = {}) => ({ id: 'stable-1', name: 'Concert', url: 'https://www.ticketweb.com/event/concert/123', dates: { start: { dateTime: '2026-11-02T01:30:00Z' }, status: { code: 'onsale' } }, ...extra })
const feed = (events = [event()], number = 0, totalPages = 1, totalElements = events.length) => JSON.stringify({ _embedded: { events }, page: { number, totalPages, totalElements, size: 200 } })
const card = (extra = '', date = '2026-11-01T19:30-0600', id = '42') => `<div id="ds-listing-content"><div class="ds-listing event-card"><a class="ds-listing-event-title" href="/events/concert"><span itemprop="name">Concert</span></a><meta itemprop="startDate" content="${date}"><a data-ds-id="${id}"></a><div class="ds-venue-name"><span itemprop="name">Hall</span></div>${extra}</div></div>`
test('SPACE keeps explicit cancellations, stable IDs, UTC and unknown prices', () => {
  const a = parseSpace(feed()).items[0]!
  const b = parseSpace(feed([event({ dates: { start: { dateTime: '2026-11-03T01:30:00Z' }, status: { code: 'cancelled' } } })])).items[0]!
  assert.equal(a.external_id, b.external_id)
  assert.equal(a.data.is_free, false)
  assert.equal(a.data.fee_text, null)
  assert.equal(b.data.is_cancelled, true)
  assert.equal(a.data.end_time, null)
  assert.throws(() => parseSpace('{}'))
  assert.throws(() => parseSpace(feed([event({ dates: {} })])))
})
test('SPACE discovers published widget URLs, drains pagination and legacy feed without eval', async () => {
  let pages = 0
  const result = await fetchSpace(async href => {
    if (href.endsWith('event-feed-widget.js')) return `if (venue === 'space') { tmUrl = 'https://app.ticketmaster.com/discovery/v2/events.json?apikey=public-example&venueId=space'; tmUrl2 = 'https://app.ticketmaster.com/discovery/v2/events.json?apikey=public-example&promoterId=1'; } else if (venue === 'other') {}`
    if (href.includes('space.js')) return 'window.apiEvents = []'
    if (href.includes('promoterId')) return feed([])
    pages++
    return new URL(href).searchParams.get('page') === '1' ? feed([event({ id: 'stable-2' })], 1, 2, 2) : feed([event()], 0, 2, 2)
  })
  assert.equal(pages, 2)
  assert.equal(result.items.length, 2)
})
test('Do312 uses numeric identity, offset, explicit free/cancelled and skips series dates', () => {
  const result = parseDo312(card('<span class="ds-listing-cancelled">Cancelled</span><meta itemprop="price" content="0">'), 'https://do312.com/events/2026/11/01')
  assert.equal(result.items[0]!.external_id, '42')
  assert.equal(result.items[0]!.data.start_time, '2026-11-02T01:30:00.000Z')
  assert.equal(result.items[0]!.data.is_cancelled, true)
  assert.equal(result.items[0]!.data.is_free, true)
  assert.equal(parseDo312(card(), 'https://do312.com/events/2026/11/01').items[0]!.data.is_free, false)
  const series = parseDo312(card('<li class="ds-listing-series">Through Nov 01</li>'), 'https://do312.com/events/2026/11/01')
  assert.equal(series.items.length, 0)
  assert.match(series.warnings.join(), /series/i)
  assert.throws(() => parseDo312('<html>Access denied</html>', 'https://do312.com/'))
})
test('Do312 drains each date pagination and fails pagination loops', async () => {
  let calls = 0
  const result = await fetchDo312(async href => {
    calls++
    return href.includes('page=2') ? card('', '2026-11-01T20:30-0600', '43') : card() + '<a class="ds-next-page" href="?page=2"></a>'
  }, new Date('2026-11-01T12:00:00Z'), 1)
  assert.equal(calls, 2)
  assert.equal(result.items.length, 2)
  await assert.rejects(fetchDo312(async () => card() + '<a class="ds-next-page" href="?page=2"></a>', new Date('2026-11-01T12:00:00Z'), 1), /pagination/i)
})
test('SPACE refuses truncated pages and executable legacy scripts', async () => {
  const widget = `if (venue === 'space') { tmUrl = 'https://app.ticketmaster.com/discovery/v2/events.json?venueId=space'; tmUrl2 = 'https://app.ticketmaster.com/discovery/v2/events.json?promoterId=1'; } else {}`
  await assert.rejects(fetchSpace(async href => href.endsWith('event-feed-widget.js') ? widget : feed([event()], 0, 1, 2)), /incomplete/)
  await assert.rejects(fetchSpace(async href => href.endsWith('event-feed-widget.js') ? widget : href.endsWith('space.js') ? 'window.apiEvents = []; fetch("https://evil.example")' : feed([])), /legacy/)
})
test('Do312 does not treat ticket giveaways as free or missing cards as a valid feed', () => {
  assert.equal(parseDo312(card('<div class="ds-listing-extra">Win free tickets!</div>'), 'https://do312.com/').items[0]!.data.is_free, false)
  assert.throws(() => parseDo312(card().replace('data-ds-id="42"', ''), 'https://do312.com/'), /identity/)
  assert.throws(() => parseDo312(card('', '2026-11-01T19:30'), 'https://do312.com/'), /datetime/)
})
test('Do312 routes all events through source detail even when the optional ticket link is malformed', () => {
  const result = parseDo312(card('<a class="ds-buy-tix" href="http://tel:312-344-3190">Call</a>'), 'https://do312.com/')
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0]!.related_url, result.items[0]!.data.source_url)
})
test('Do312 uses explicit admission banners, never giveaway text, for free status', () => {
  const result = parseDo312(card('<ul class="ds-listing-banners"><li><span>Free</span></li></ul>'), 'https://do312.com/')
  assert.equal(result.items[0]!.data.is_free, true)
  assert.equal(result.items[0]!.data.fee_text, 'Free')
})
test('Do312 detail extraction reads its own body and follows organizer after preserving source description', async () => {
  const { enrichSource, extractDetail } = await import('../src/enrichment.ts')
  const item = parseDo312(card(), 'https://do312.com/').items[0]!
  const description = 'An evening of chamber music featuring local musicians performing a carefully selected program of contemporary works.'
  const html = `<meta property="og:image" content="https://assets0.dostuffmedia.com/poster.jpg"><div class="ds-event-detail"><h1>Concert</h1><a class="ds-buy-tix" href="https://www.northwestern.edu/concert">Buy tickets</a><div class="ds-event-description-inner"><p>${description}</p></div></div>`
  const detail = extractDetail(html, item.data.source_url, item)!
  assert.equal(detail.description, description)
  assert.equal(detail.image, 'https://assets0.dostuffmedia.com/poster.jpg')
  assert.deepEqual(detail.next, ['https://www.northwestern.edu/concert'])
  const visited: string[] = []
  const enriched = await enrichSource({ items: [item], warnings: [] }, async address => {
    visited.push(address)
    return { url: address, html: address.includes('do312.com') ? html : '<h1>Concert</h1><main><p>Organizer confirmation.</p></main>' }
  }, new Date('2026-11-01T12:00:00Z'))
  assert.equal(visited.length, 2)
  assert.ok(enriched.items[0]!.data.description?.includes(description))
})
test('Do312 semantic apply sees plain div prose and an icon-only publisher ticket link', async () => {
  const { buildEvidence, buildRequest, createJev } = await import('../src/semantic.ts')
  const { enrichSource } = await import('../src/enrichment.ts')
  const item = parseDo312(card(), 'https://do312.com/').items[0]!
  const description = 'Bring in your favorite game and stay a while! All games are welcome. Seating is first come first serve.'
  const organizer = 'https://www.emporiumarcadebar.com/event/bring-your-own-game-night/2026-11-01/'
  const html = `<meta property="og:description" content="Generic site promotion"><meta property="og:image" content="https://assets0.dostuffmedia.com/poster.jpg"><nav><p>Unrelated sitewide promotional navigation fills this paragraph.</p></nav><div class="ds-event-detail"><h1>Concert</h1><nav class="ds-utility-nav"><a class="ds-buy-tix" href="${organizer}"><span class="icon"></span></a></nav><div class="ds-event-description-inner">RSVP Free Tokens<br><br>${description}</div></div>`
  const evidence = buildEvidence(html, item.data.source_url, item)
  assert.ok(evidence.blocks.some(b => b.text.includes(description)))
  assert.ok(evidence.blocks.every(b => !/Generic site|sitewide/.test(b.text)))
  assert.equal(evidence.links.find(l => l.url === organizer)?.label, 'Buy tickets (publisher event button)')
  assert.ok(!buildEvidence(html, 'https://www.northwestern.edu/concert', item).links.some(l => l.url === organizer), 'Do312 icon-button handling is host-specific')
  const jev = createJev({ key: 'test', fetch: async (_url, options) => {
    const request = JSON.parse(String(options?.body)) as ReturnType<typeof buildRequest>
    const answers: Record<string, unknown> = {}
    for (const [id, question] of Object.entries(request.questions)) {
      if (question.type === 'noul') { answers[id] = { type: 'noul', noul: 0.99 }; continue }
      const selected = id === 'relationship' ? 'occurrence' : id === 'image' ? 'i0' : request.state.links.find(l => l.url === organizer)?.id || 'none'
      const choices = Object.keys(question.criteria!)
      answers[id] = { type: 'choice', choice: selected, confidence: 0.99, probabilities: Object.fromEntries(choices.map(c => [c, c === selected ? 0.99 : 0.01 / (choices.length - 1)])) }
    }
    return new Response(JSON.stringify({ model: 'jev-1.13.0', answers }))
  } })
  const visits: string[] = []
  const applied = await enrichSource({ items: [item], warnings: [] }, async address => {
    visits.push(address)
    return { url: address, html: address === organizer ? '<h1>Concert</h1><main><p>All games are welcome. Seating is first come first serve.</p></main>' : html }
  }, new Date('2026-11-01T12:00:00Z'), { mode: 'apply', select: jev.select })
  assert.ok(applied.items[0]!.data.description?.includes(description))
  assert.ok(applied.items[0]!.semantic?.every(a => a.outcome === 'accepted'))
  assert.deepEqual(visits, [item.data.source_url, organizer])
  assert.equal(applied.items[0]!.data.cover_image_url, 'https://assets0.dostuffmedia.com/poster.jpg')
})
