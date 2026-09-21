import type { Coordinates } from './geocoding'
import type { EventListItem } from './events'

export const demoMaps = import.meta.env?.DEV && import.meta.env.VITE_GOOGLE_MAPS_DEMO === 'true'
const cache = new Map<string, Promise<Coordinates | null>>()
async function fetchDemoAddress(address: string): Promise<Coordinates | null> {
  const response = await fetch(`/__demo/geocode?${new URLSearchParams({ address })}`)
  if (!response.ok) throw new Error(response.status === 429 ? 'Google demo geocoding quota reached. Try again later.' : `Location lookup unavailable (${response.status}). Try again later.`)
  return response.json()
}

/** Local prototype only: session-memory results, no production writes or background jobs. */
export async function locateDemoEvents(events: EventListItem[]) {
  const located: Array<{ id: string; title: string; event_coordinates: { latitude: number; longitude: number } }> = []
  let deferred = 0
  let warning = ''
  for (const event of events) {
    if (!event.location || /^(online|virtual|no location|tba|tbd)$/i.test(event.location.trim())) continue
    const address = /chicago|evanston/i.test(event.location) ? event.location : `${event.location}${event.region === 'chicago' ? ', Chicago, IL' : event.region === 'evanston' ? ', Evanston, IL' : ''}`
    // ponytail: cap prototype lookups at 50 distinct addresses per page session; use the backend cache for launch.
    if (!cache.has(address)) {
      if (warning || cache.size >= 50) { deferred++; continue }
      const pending = fetchDemoAddress(address)
      cache.set(address, pending)
      pending.catch(() => cache.delete(address))
    }
    try {
      const coordinates = await cache.get(address)!
      if (coordinates) located.push({ id: event.id, title: event.title, event_coordinates: coordinates })
    } catch (error) { warning = error instanceof Error ? error.message : 'Location lookup unavailable'; deferred++ }
  }
  return { located, deferred, warning }
}
