import { parseArgs } from 'node:util'
import { createClient } from '@supabase/supabase-js'

import { geocodeAddress, type Coordinates } from '../../web/src/lib/geocoding.ts'
export { parseGeocoding } from '../../web/src/lib/geocoding.ts'

async function main() {
  const { values } = parseArgs({ options: {
    apply: { type: 'boolean', default: false }, purge: { type: 'boolean', default: false },
    limit: { type: 'string', default: '50' },
  } })
  const limit = Number(values.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Limit must be 1–500 addresses')
  const url = process.env.SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !secret) throw new Error('Backend Supabase credentials required')
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  const now = new Date()
  if (values.apply || values.purge) {
    const { error } = await client.from('event_coordinates').delete().lte('expires_at', now.toISOString())
    if (error) throw new Error(`Coordinate cleanup failed: ${error.code}`)
    if (values.purge) return
  }
  const events: Array<{ id: string; location: string | null; region: string }> = []
  for (let page = 0; ; page++) {
    const { data, error } = await client.from('events').select('id,location,region').eq('status', 'published')
      .gte('start_time', now.toISOString()).lt('start_time', new Date(+now + 60 * 86400_000).toISOString())
      .order('id').range(page * 500, page * 500 + 499)
    if (error) throw new Error(`Event read failed: ${error.code}`)
    events.push(...data)
    if (data.length < 500) break
  }
  let requests = 0, located = 0, unresolved = 0
  const key = process.env.GOOGLE_GEOCODING_API_KEY
  if (values.apply && !key) throw new Error('Set backend GOOGLE_GEOCODING_API_KEY before --apply')
  const groups = new Map<string, typeof events>()
  for (const event of events) {
    if (!event.location || /^(online|virtual|no location|tba|tbd)$/i.test(event.location.trim())) { unresolved++; continue }
    const address = /chicago|evanston/i.test(event.location) ? event.location : `${event.location}${event.region === 'chicago' ? ', Chicago, IL' : event.region === 'evanston' ? ', Evanston, IL' : ''}`
    groups.set(address, [...(groups.get(address) ?? []), event])
  }
  for (const [address, rows] of groups) {
    // Reuse only a still-current match for this exact location; expiry is never extended by copying.
    const { data: existing, error } = await client.from('event_coordinates').select('*')
      .eq('address_query', address).gt('expires_at', now.toISOString()).limit(1).maybeSingle()
    if (error) throw new Error(`Coordinate read failed: ${error.code}`)
    if (!existing && requests >= limit) { unresolved += rows.length; continue }
    if (!values.apply) { if (!existing) requests++; else located += rows.length; continue }
    let coordinates: Coordinates | null = existing
    let expires = existing?.expires_at as string | undefined
    if (!coordinates) {
      requests++
      coordinates = await geocodeAddress(address, key!)
      expires = new Date(Date.now() + 29 * 86400_000).toISOString()
    }
    if (!coordinates) { unresolved += rows.length; continue }
    for (const row of rows) {
      const { error: writeError } = await client.from('event_coordinates').upsert({
        event_id: row.id, coordinate_location: row.location, address_query: address,
        latitude: coordinates.latitude, longitude: coordinates.longitude, place_id: coordinates.place_id,
        expires_at: expires,
      })
      if (writeError) throw new Error(`Coordinate write failed: ${writeError.code}`)
      located++
    }
  }
  console.log(JSON.stringify({ mode: values.apply ? 'apply' : 'dry-run', events: events.length, address_requests: requests, located, unresolved }))
}

if (import.meta.main) main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Coordinate lookup failed')
  process.exitCode = 1
})
