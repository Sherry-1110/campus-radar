import type { EventListItem } from './events'

export type FeaturedCandidate = EventListItem & { description: string | null; featured_rank?: number | null }

const SPECIAL = new Set(['music', 'arts', 'exhibition', 'play', 'market', 'social'])
const DAY = 86_400_000

/** Higher means bigger: a long write-up, a multi-day run, a link to more information. */
export function featuredScore(e: FeaturedCandidate): number {
  const days = (Date.parse(e.end_time ?? e.start_time) - Date.parse(e.start_time)) / DAY
  return Math.min((e.description ?? '').length, 1500) / 300
    + (days >= 1.5 ? 2 : 0)
    + (e.more_info_url ? 1 : 0)
}

// ponytail: heuristic over one fetched batch, after any hand-picked events (featured_rank).
/**
 * Hand-picked events come first, in their rank order. The rest are events with posters that look big; only
 * show-like categories qualify (not talks or meetings), and a series or a repeated title appears once.
 */
export function pickFeatured(rows: FeaturedCandidate[], limit = 8): EventListItem[] {
  const rank = (e: FeaturedCandidate) => e.featured_rank ?? Infinity
  const seen = new Set<string>()
  const fresh = (e: FeaturedCandidate) => {
    const keys = [e.series_id, e.title].filter((k): k is string => Boolean(k))
    if (keys.some(k => seen.has(k))) return false
    keys.forEach(k => seen.add(k))
    return true
  }
  const chosen = [...rows]
    .sort((a, b) => rank(a) - rank(b) || (a.featured_rank ? 0 : featuredScore(b) - featuredScore(a)) || a.start_time.localeCompare(b.start_time))
    .filter(e => e.cover_image_url && !e.is_cancelled && (e.featured_rank || e.categories.some(c => SPECIAL.has(c))) && fresh(e))
  const picks = chosen.filter(e => e.featured_rank).length
  return chosen
    .slice(0, Math.max(limit, picks))
    .map(({ description: _description, featured_rank: _rank, ...item }) => item)
}
