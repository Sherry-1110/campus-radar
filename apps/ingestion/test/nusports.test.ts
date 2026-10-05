import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchNuSports } from '../src/sources/nusports.ts'

const sport = (name: string, slug: string) => ({ sport: { name, slug } })
const game = (extra: Record<string, unknown>) => ({
  id: 1, datetime: '2026-10-10T16:30:00.000000Z', datetime_end: null, is_all_day: false, tba: null,
  venue_type: 'home', venue: 'Ryan Field', location: 'Evanston, Ill.', status: 'as_scheduled',
  opponent_name: 'Ball State', opponent: { official_logo: { url: 'https://storage.googleapis.com/nusports-com-prod/school_logos/ball-st.svg' }, custom_logo: null },
  schedule: sport('Football', 'football'), ...extra,
})
const page = (data: unknown[], current = 1, last = 1) => JSON.stringify({ data, meta: { current_page: current, last_page: last } })

test('NU Athletics keeps attendable games, names them clearly and walks every page', async () => {
  const pages = [
    page([game({}), game({ id: 2, venue_type: 'away', location: 'Piscataway, N.J.' }), game({ id: 3, venue_type: 'neutral', location: 'Chicago, Ill.', venue: 'Wrigley Field', opponent_name: 'Purdue' })], 1, 2),
    page([game({ id: 4, opponent_logo: { url: 'https://nusports.com/imgproxy/abc/windy.png' }, opponent_name: 'Windy City Collegiate Classic', schedule: sport("Women's Golf", 'womens-golf'), is_all_day: true, venue: null, location: 'Glencoe, Ill.', datetime: '2026-10-05T05:00:00.000000Z' })], 2, 2),
  ]
  const seen: string[] = []
  const result = await fetchNuSports(async url => { seen.push(url); return pages[seen.length - 1]! })
  assert.equal(seen.length, 2)
  assert.deepEqual(result.items.map(i => i.data.title), [
    'Northwestern Football vs. Ball State',
    'Northwestern Football vs. Purdue',
    "Northwestern Women's Golf: Windy City Collegiate Classic",
  ])
  const [home, , tournament] = result.items
  assert.equal(home!.data.location, 'Ryan Field, Evanston, Ill.')
  assert.equal(home!.data.category, 'sports')
  assert.equal(home!.data.source_url, 'https://nusports.com/sports/football/schedule')
  assert.equal(home!.data.cover_image_url, 'https://storage.googleapis.com/nusports-com-prod/school_logos/ball-st.svg')
  assert.equal(tournament!.data.is_all_day, true)
  assert.equal(tournament!.data.cover_image_url, 'https://nusports.com/imgproxy/abc/windy.png', 'the game\'s own logo wins')
  assert.equal(tournament!.data.end_time, '2026-10-06T04:59:59.999Z')
})

test('NU Athletics marks cancellations and rejects malformed responses', async () => {
  const cancelled = await fetchNuSports(async () => page([game({ status: 'canceled' })]))
  assert.equal(cancelled.items[0]!.data.is_cancelled, true)
  const foreign = await fetchNuSports(async () => page([game({ opponent: { official_logo: { url: 'https://evil.example/logo.svg' }, custom_logo: null } })]))
  assert.equal(foreign.items[0]!.data.cover_image_url, null, 'only logos hosted by NU Athletics are used')
  await assert.rejects(fetchNuSports(async () => '{"error":"down"}'), /unexpected/)
  await assert.rejects(fetchNuSports(async () => page([game({ schedule: null })])), /missing sport/)
})
