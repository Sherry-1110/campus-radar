import { geocodeAddress } from './geocoding.ts'

// Prototype cache per Worker instance; Google's demo quota remains the overall limit.
const cache = new Map<string, { result: ReturnType<typeof geocodeAddress>; expires: number }>()

export async function demoGeocode(request: Request, key: string | undefined): Promise<Response> {
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } })
  const address = new URL(request.url).searchParams.get('address')?.trim()
  if (!address || address.length > 400) return reply({ error: 'Invalid address' }, 400)
  if (!key) return reply({ error: 'Demo map key is not configured' }, 503)
  for (const [address, entry] of cache) if (entry.expires <= Date.now()) cache.delete(address)
  if (!cache.has(address)) {
    if (cache.size >= 50) return reply({ error: 'Prototype lookup limit reached. Try again later.' }, 429)
    cache.set(address, { result: geocodeAddress(address, key), expires: Date.now() + 60 * 60 * 1000 })
  }
  const entry = cache.get(address)!
  try {
    return reply(await entry.result)
  } catch (error) {
    if (cache.get(address) === entry) cache.delete(address)
    const quota = error instanceof Error && error.message === 'Google Geocoding HTTP 429'
    return reply({ error: quota ? 'Google demo geocoding quota reached' : 'Location lookup unavailable' }, quota ? 429 : 502)
  }
}
