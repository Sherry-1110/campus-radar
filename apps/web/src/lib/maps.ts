import { eventSource } from './eventSource.ts'

// Listing pages on the aggregators, as opposed to an organizer's own page.
const AGGREGATOR = /^https?:\/\/([^/]*\.)?(choosechicago\.com|planitpurple\.northwestern\.edu)(\/|$)/i

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

type EventPageInput = { more_info_url: string | null } & Parameters<typeof eventSource>[0]

/**
 * The event's own page. Prefer an organizer page that ingestion has already
 * verified (stored as source_url), then the listing's "More info" target, and
 * only then the aggregator's listing page.
 */
export function eventPageUrl(event: EventPageInput): string | null {
  const verified = event.source_url && !AGGREGATOR.test(event.source_url) ? event.source_url : null
  return verified || event.more_info_url || eventSource(event)?.url || null
}
