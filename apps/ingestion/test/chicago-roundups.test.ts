import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { ARTICLE, fetchChicagoRoundups, parseArticle, parseDates } from '../src/sources/chicago-roundups.ts'

test('roundup dates become first and last days', () => {
  const today = '2026-10-05'
  assert.deepEqual(parseDates('Oct. 11', today), ['2026-10-11', '2026-10-11'])
  assert.deepEqual(parseDates('Oct. 9– 11', today), ['2026-10-09', '2026-10-11'])
  assert.deepEqual(parseDates('Oct. 30 – Nov. 2', today), ['2026-10-30', '2026-11-02'])
  assert.deepEqual(parseDates('through Oct. 11', today), [today, '2026-10-11'])
  assert.deepEqual(parseDates('through October', today), [today, '2026-10-31'])
  assert.deepEqual(parseDates('starting Oct. 3', today), ['2026-10-03', '2026-10-31'])
  assert.deepEqual(parseDates('Jan. 3', '2026-12-20'), ['2027-01-03', '2027-01-03'])
  assert.equal(parseDates('Fridays in October', today), null)
})

test('roundup dates preserve explicit years and November opening/range labels', () => {
  const today = '2026-11-06'
  for (const [dates, expected] of [
    ['Nov. 6, 2026', ['2026-11-06', '2026-11-06']],
    ['Nov. 14 – 15, 2026', ['2026-11-14', '2026-11-15']],
    ['Nov. 13 – Dec. 31, 2026', ['2026-11-13', '2026-12-31']],
    ['Nov. 13, 2026 – Jan. 3, 2027', ['2026-11-13', '2027-01-03']],
    ['Opens Nov. 7, 2026', ['2026-11-07', '2026-11-30']],
    ['Starts Nov. 13, 2026', ['2026-11-13', '2026-11-30']],
    ['Through Nov. 29, 2026', [today, '2026-11-29']],
    ['Now open through Jan. 31, 2027', [today, '2027-01-31']],
    ['Nov. 6, 2025', ['2025-11-06', '2025-11-06']],
  ] as const) assert.deepEqual(parseDates(dates, today), expected, dates)
  assert.equal(parseDates('Nov. 31, 2026', today), null)
  assert.equal(parseDates('Nov. 20 – 13, 2026', today), null)
})

test('November heading-based picks retain organizer links, date ranges and conditional admission', async () => {
  const html = await readFile(new URL('./fixtures/chicago-roundups-november.html', import.meta.url), 'utf8')
  const picks = parseArticle(html)
  assert.equal(picks.length, 9, 'Ignore the duplicate overview and unrelated hotel section')
  assert.deepEqual(picks[0], {
    name: 'Christmas Around the World', link: 'https://www.griffinmsi.org/exhibits/christmas-around-the-world',
    dates: 'Opens Nov. 7, 2026', free: false,
  })
  const result = await fetchChicagoRoundups(async raw => {
    if (raw === ARTICLE) return html
    assert.equal(new URL(raw).pathname, '/wp-json/tribe/events/v1/events')
    return JSON.stringify({ events: [] })
  }, new Date('2026-11-06T15:00:00Z'))
  assert.equal(result.items.length, 9)
  assert.deepEqual(result.warnings, [])
  const lightscape = result.items.find(item => item.data.title === 'Lightscape')!
  assert.equal(lightscape.data.start_time, '2026-11-13T06:00:00.000Z')
  assert.equal(lightscape.data.end_time, '2027-01-04T05:59:59.999Z')
  assert.deepEqual(result.items.filter(item => item.data.is_free).map(item => item.data.title), ['Christkindlmarket Chicago'])
  await assert.rejects(fetchChicagoRoundups(async () => '<h2>Access denied</h2>'), /only 0 picks/)
  assert.throws(() => parseArticle(html.replace('https://www.griffinmsi.org/exhibits/christmas-around-the-world', 'javascript:alert(1)')), /URL/)
})

const pick = (name: string, href: string, dates: string, blurb = 'Something to see.') =>
  `<p><a href="${href}"><b>${name}</b></a><span> (${dates}):</span> ${blurb}</p>`
const article = `<article>
  <h2>Top events in Chicago this October</h2>
  <p>Intro paragraph with <a href="https://example.com">a link</a>.</p>
  ${pick('Chicago Fashion Week', 'https://chicagofashionweek.com/', 'Oct. 8 – 18')}
  ${pick('Maxwell Street Market', 'https://www.chicago.gov/maxwell.html', 'Oct. 4')}
  ${pick('Spooky Zoo', 'https://www.lpzoo.org/event/spooky-zoo/', 'Oct. 17', 'The zoo hosts this free trick-or-treating party.')}
  <h2>More events in Chicago in October</h2>
  <div><p><strong><a href="https://chicagoevents.com/event/lincoln-park-wine-fest">Lincoln Park Wine Fest</a></strong> (Oct. 9– 11): Wine.</p></div>
  ${pick('Destinos: Chicago International Latino Theater Festival', 'http://www.clata.org/', 'through Oct. 11')}
  ${pick('Mystery Night', 'https://mystery.example/', 'Fridays in October')}
  <h3>Popular posts</h3><p><b>Not a pick</b> (Oct. 9): ignore me.</p>
  <h2>Explore Chicago hotels</h2><p><a href="https://hotel.example/"><b>Hotel</b></a> (Oct. 9): no.</p>
</article>`

test('roundup picks skip past events and anything the event calendar already lists', async () => {
  const searched: string[] = []
  const result = await fetchChicagoRoundups(async url => {
    if (url === ARTICLE) return article
    const name = new URL(url).searchParams.get('search')!
    searched.push(name)
    const events = name === 'Lincoln Park Wine Fest' ? [{ title: '10th Annual Lincoln Park Wine Fest', website: 'https://chicagoevents.com/event/lincoln-park-wine-fest' }]
      : name.startsWith('Destinos') ? [{ title: 'Tzinelas &#8211; Destinos: 9th Chicago International Latino Theater Festival', website: 'https://www.clata.org/en/productions/Tzinelas' }]
      : [{ title: 'Unrelated Fashion Film Festival', website: 'https://www.evanstonartcenter.org' }]
    return JSON.stringify({ events })
  }, new Date('2026-10-05T15:00:00Z'))

  assert.deepEqual(result.items.map(i => i.data.title), ['Chicago Fashion Week', 'Spooky Zoo'])
  assert.ok(!searched.includes('Maxwell Street Market'), 'past events need no lookup')
  const [week, zoo] = result.items
  assert.equal(week!.external_id, '2026:chicago-fashion-week')
  assert.equal(week!.related_url, 'https://chicagofashionweek.com/')
  assert.equal(week!.data.start_time, '2026-10-08T05:00:00.000Z')
  assert.equal(week!.data.end_time, '2026-10-19T04:59:59.999Z')
  assert.equal(week!.data.is_free, false)
  assert.equal(zoo!.data.is_free, true)
  assert.deepEqual(result.warnings, ['Chicago roundups: unreadable dates "Fridays in October" for Mystery Night'])
})
