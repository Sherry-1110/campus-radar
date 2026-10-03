export interface Coordinates { latitude: number; longitude: number; place_id: string }
export interface GeocodingResponse {
  results?: Array<{ placeId?: string; types?: string[]; granularity?: string;
    location?: { latitude: number; longitude: number }; postalAddress?: { regionCode?: string } }>
  error?: { status?: string }
}

export function parseGeocoding(payload: GeocodingResponse): Coordinates | null {
  if (payload.error) throw new Error(`Google Geocoding: ${payload.error.status || 'request failed'}`)
  if (payload.results?.length !== 1) return null
  const result = payload.results[0]
  const point = result.location
  const precise = result.types?.some(type => ['street_address', 'premise', 'subpremise', 'establishment', 'point_of_interest', 'park'].includes(type))
  if (!point || !precise || result.postalAddress?.regionCode !== 'US' || !['ROOFTOP', 'GEOMETRIC_CENTER'].includes(result.granularity ?? '') || !result.placeId ||
      !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) ||
      point.latitude < 41 || point.latitude > 43 || point.longitude < -89 || point.longitude > -87) return null
  return { ...point, place_id: result.placeId }
}

export async function geocodeAddress(address: string, key: string): Promise<Coordinates | null> {
  const params = new URLSearchParams({
    'locationBias.rectangle.low.latitude': '41', 'locationBias.rectangle.low.longitude': '-89',
    'locationBias.rectangle.high.latitude': '43', 'locationBias.rectangle.high.longitude': '-87',
  })
  let response: Response
  try {
    response = await fetch(`https://geocode.googleapis.com/v4/geocode/address/${encodeURIComponent(address)}?${params}`, {
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'results.placeId,results.location,results.types,results.granularity,results.postalAddress.regionCode' },
      signal: AbortSignal.timeout(15000), redirect: 'manual',
    })
  } catch (error) { throw new Error(error instanceof DOMException && error.name === 'TimeoutError' ? 'Google Geocoding timed out' : 'Google Geocoding could not connect') }
  if (response.status === 429) {
    const payload = await response.json().catch(() => null) as { error?: { details?: Array<{ metadata?: { quota_unit?: string } }> } } | null
    if (payload?.error?.details?.some(detail => detail.metadata?.quota_unit?.startsWith('1/d/'))) {
      throw new Error('Google Geocoding daily quota reached; remaining locations deferred to the next ingestion run')
    }
  }
  if (!response.ok) throw new Error(`Google Geocoding HTTP ${response.status}`)
  return parseGeocoding(await response.json() as GeocodingResponse)
}
