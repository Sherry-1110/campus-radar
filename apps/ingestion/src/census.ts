export type VenueCoordinates = {
  latitude: number; longitude: number; place_id: string | null
  provider: 'google' | 'census'; matched_address: string | null
}

const streetEnding = /\b(street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|lane|ln|court|ct|place|pl|parkway|pkwy|way|terrace|ter|mall|plaza)\.?$/i
const streetTypes: Record<string, string> = { STREET: 'ST', AVENUE: 'AVE', ROAD: 'RD', DRIVE: 'DR', BOULEVARD: 'BLVD', LANE: 'LN', COURT: 'CT', PLACE: 'PL', PARKWAY: 'PKWY', TERRACE: 'TER' }
function streetKey(street: string) {
  return street.toUpperCase().replace(/[.]/g, '').replace(/\bNORTH\b/g, 'N').replace(/\bSOUTH\b/g, 'S')
    .replace(/\bEAST\b/g, 'E').replace(/\bWEST\b/g, 'W').replace(streetEnding, suffix => streetTypes[suffix] ?? suffix).replace(/\s+/g, ' ').trim()
}

/** Extract a single street from publisher location text; do not guess a venue's address. */
export function censusAddress(location: string) {
  const parts = location.split(',').map(part => part.trim()).filter(Boolean)
  if (parts.some(part => /^[A-Z]{2}$/.test(part) && part !== 'IL')) return null
  const streets = parts.filter(part => /^\d+[A-Za-z]?\s+/.test(part)
    && !/\b(floor|suite|room|studio|fl|level)\b/i.test(part)
    && (streetEnding.test(part) || /^\d+[A-Za-z]?\s+[NSEW]\.?(?:\s|[A-Z])/i.test(part)))
  const unique = new Map(streets.map(street => [streetKey(street), street]))
  if (unique.size !== 1) return null
  const street = [...unique.values()][0]
  if (/(?:\band\b|&|\/)\s*\d/i.test(street)) return null
  const zip = location.match(/\b(60\d{3})(?:-\d{4})?\b/)?.[1] ?? ''
  const city = parts.find(part => /^(Chicago|Evanston)$/i.test(part))
    ?? (zip ? parts.slice(parts.indexOf(street) + 1).find(part => /^[A-Za-z][A-Za-z .'-]+$/.test(part) && !/^(IL|floor|suite|room|studio)/i.test(part)) : '') ?? ''
  if (!zip && !city) return null
  return { street, city, state: 'IL', zip }
}

export async function geocodeCensus(location: string): Promise<VenueCoordinates | null> {
  const address = censusAddress(location)
  if (!address) return null
  const params = new URLSearchParams({ ...address, benchmark: 'Public_AR_Current', format: 'json' })
  let response: Response
  try {
    response = await fetch(`https://geocoding.geo.census.gov/geocoder/locations/address?${params}`, {
      signal: AbortSignal.timeout(20000), redirect: 'error', headers: { 'User-Agent': 'CampusRadar/1.0 (+https://campus-radar.com)' },
    })
  } catch { throw new Error('Census geocoding could not connect') }
  if (!response.ok) throw new Error(`Census Geocoding HTTP ${response.status}`)
  const payload = await response.json() as { result?: { addressMatches?: Array<{
    matchedAddress?: string; coordinates?: { x?: number; y?: number }; addressComponents?: { state?: string; zip?: string; city?: string }
  }> } }
  const matches = payload.result?.addressMatches
  if (!Array.isArray(matches) || matches.length !== 1) return null
  const match = matches[0], latitude = match.coordinates?.y, longitude = match.coordinates?.x
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < 41 || latitude > 43 || longitude < -89 || longitude > -87 || match.addressComponents?.state !== 'IL'
    || !match.matchedAddress || streetKey(match.matchedAddress.split(',')[0]) !== streetKey(address.street)
    || (address.zip ? match.addressComponents?.zip !== address.zip : match.addressComponents?.city?.toLowerCase() !== address.city.toLowerCase())) return null
  return { latitude, longitude, place_id: null, provider: 'census', matched_address: match.matchedAddress }
}
