export interface PlaceFields {
  area: 'campus' | 'nearby'
  location: string | null
  neighborhood: string | null
}

/** First segment of a free-text address: the venue or building name. */
export function venueName(location: string | null): string | null {
  const first = location?.split(',')[0]?.trim()
  if (!first || /^no location$/i.test(first)) return null
  return first
}

/** On campus: the specific place. Off campus: the neighborhood (falling back to the venue). */
export function cardPlace(event: PlaceFields): string | null {
  const venue = venueName(event.location)
  if (event.area === 'campus') return venue
  return event.neighborhood?.trim() || venue
}
