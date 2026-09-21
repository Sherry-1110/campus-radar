const NO_ADDRESS = /^(no location|online|tbd|to be determined|virtual)$|^online\b/i

/**
 * Google Maps search link for an event's free-text location, or null when
 * there is nothing to look up (online events, no location).
 */
export function googleMapsUrl(location: string | null, region: string | null): string | null {
  const text = location?.replace(/(?:\s*,\s*)+/g, ', ').replace(/^,\s*|,\s*$/g, '').trim()
  if (!text || NO_ADDRESS.test(text)) return null

  // A bare venue name ("Theater Wit") needs the city for Maps to find the right place.
  let query = text
  if (region === 'chicago' && !/chicago/i.test(text)) query += ', Chicago, IL'
  else if (region === 'evanston' && !/evanston/i.test(text)) query += ', Evanston, IL'

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

/** The real event page (the listing's "More info" target), else the listing itself. */
export function eventPageUrl(event: { more_info_url: string | null; source_url: string | null }): string | null {
  return event.more_info_url || event.source_url || null
}
