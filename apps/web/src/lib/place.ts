export interface PlaceFields {
  area: 'campus' | 'nearby'
  location: string | null
  neighborhood: string | null
  region?: string | null
}

/** First segment of a free-text address: the venue or building name. */
export function venueName(location: string | null): string | null {
  const first = location?.split(',')[0]?.trim()
  if (!first || /^no location$/i.test(first)) return null
  return first
}

/** Venue plus area, without repeating the same label. */
export function cardPlace(event: PlaceFields): string | null {
  const venue = venueName(event.location)
  const area = event.neighborhood?.trim() || ({ evanston: 'Evanston', chicago: 'Chicago' }[event.region ?? ''])
  return [...new Set([venue, area].filter(Boolean))].join(' · ') || null
}
