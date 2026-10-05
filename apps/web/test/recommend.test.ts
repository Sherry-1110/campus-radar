import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickFeatured, type FeaturedCandidate } from '../src/lib/recommend.ts'

const event = (id: string, extra: Partial<FeaturedCandidate> = {}): FeaturedCandidate => ({
  id, series_id: null, title: id, title_zh: null, location_zh: null, cover_image_url: 'p.jpg', start_time: '2026-10-10T20:00:00Z', end_time: '2026-10-10T22:00:00Z',
  location: null, is_free: false, fee_text: null, category: 'other', categories: ['other'], area: null, region: null,
  neighborhood: null, is_cancelled: false, is_all_day: false, source_url: null, more_info_url: null, description: null, ...extra,
})

test('featured events need a poster, skip talks, show a series once, and rank big or special ones first', () => {
  const picked = pickFeatured([
    event('plain', { categories: ['academic'], description: 'x'.repeat(2000) }),
    event('small', { categories: ['arts'] }),
    event('no-poster', { cover_image_url: null, description: 'x'.repeat(2000) }),
    event('run-1', { series_id: 's', categories: ['arts'], description: 'x'.repeat(2000) }),
    event('run-2', { series_id: 's', categories: ['arts'], description: 'x'.repeat(2000) }),
    event('festival', { categories: ['market'], description: 'x'.repeat(900) }),
    event('festival', { categories: ['market'], description: 'x'.repeat(900) }),
  ])
  assert.deepEqual(picked.map(e => e.id), ['run-1', 'festival', 'small'])
  assert.equal('description' in picked[0]!, false)
})
