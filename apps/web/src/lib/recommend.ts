import type { EventListItem } from './events'

export type FeaturedCandidate = EventListItem & { description: string | null }

const SPECIAL = new Set(['music', 'arts', 'exhibition', 'play', 'market', 'social'])
const DAY = 86_400_000

/** Higher means bigger: a long write-up, a multi-day run, a link to more information. */
export function featuredScore(e: FeaturedCandidate): number {
  const days = (Date.parse(e.end_time ?? e.start_time) - Date.parse(e.start_time)) / DAY
  return Math.min((e.description ?? '').length, 1500) / 300
    + (days >= 1.5 ? 2 : 0)
    + (e.more_info_url ? 1 : 0)
}

// ponytail: heuristic over one fetched batch; swap for a curated flag or save counts once they exist.
/** Picks events with posters that look big; only show-like categories qualify (not talks or meetings), and a series appears once. */
export function pickFeatured(rows: FeaturedCandidate[], limit = 8): EventListItem[] {
  const seen = new Set<string>()
  return rows
    .filter(e => e.cover_image_url && e.categories.some(c => SPECIAL.has(c)) && !e.is_cancelled && !seen.has(e.series_id ?? e.title) && seen.add(e.series_id ?? e.title))
    .sort((a, b) => featuredScore(b) - featuredScore(a) || a.start_time.localeCompare(b.start_time))
    .slice(0, limit)
    .map(({ description: _description, ...item }) => item)
}
