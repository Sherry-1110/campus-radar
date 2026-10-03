import { appendFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { startOfChicagoDay } from '../../web/src/lib/dates.ts'
import { geocodeAddress, type Coordinates } from '../../web/src/lib/geocoding.ts'
export { parseGeocoding } from '../../web/src/lib/geocoding.ts'

type StoredCoordinates = Coordinates & { event_id: string; coordinate_location: string; address_query: string; expires_at: string }

export async function geocodeVenue(address: string, key: string): Promise<Coordinates | null> {
  for (let attempt = 0; ; attempt++) {
    try { return await geocodeAddress(address, key) }
    catch (error) {
      if (attempt >= 3 || !(error instanceof Error) || !/^Google Geocoding HTTP (429|50[0234])$/.test(error.message)) throw error
      await delay(1000 * 2 ** attempt)
    }
  }
}

export async function syncCoordinates(client: SupabaseClient, { apply, limit, key, now = new Date() }: {
  apply: boolean; limit: number; key?: string; now?: Date
}, locate = geocodeVenue) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Limit must be 1–500 addresses')
  if (apply && !key) throw new Error('Set backend GOOGLE_GEOCODING_API_KEY before --apply')
  if (apply) {
    const { error } = await client.from('event_coordinates').delete().lte('expires_at', now.toISOString())
    if (error) throw new Error(`Coordinate cleanup failed: ${error.code}`)
  }
  const events: Array<{ id: string; location: string | null; region: string }> = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from('events').select('id,location,region').eq('status', 'published')
      .gte('start_time', startOfChicagoDay(now).toISOString())
      .order('start_time').order('id').range(offset, offset + 499)
    if (error) throw new Error(`Event read failed: ${error.code}`)
    events.push(...data)
    if (data.length < 500) break
  }
  const byEvent = new Map<string, StoredCoordinates>()
  const byAddress = new Map<string, StoredCoordinates>()
  // Refresh before the next nightly run; copying a cached result never extends its expiry.
  const freshAfter = new Date(+now + 86400_000).toISOString()
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from('event_coordinates').select('*').gt('expires_at', freshAfter)
      .order('event_id').range(offset, offset + 499)
    if (error) throw new Error(`Coordinate read failed: ${error.code}`)
    for (const row of data as StoredCoordinates[]) {
      if (row.expires_at <= freshAfter) continue
      byEvent.set(row.event_id, row)
      const existing = byAddress.get(row.address_query)
      if (!existing || existing.expires_at < row.expires_at) byAddress.set(row.address_query, row)
    }
    if (data.length < 500) break
  }
  const report = { mode: apply ? 'apply' : 'dry-run', events: events.length, address_requests: 0, located: 0, unresolved: 0, deferred: 0, warning: '' }
  const groups = new Map<string, typeof events>()
  for (const event of events) {
    if (!event.location || /^(online|virtual|no location|tba|tbd)$/i.test(event.location.trim())) { report.unresolved++; continue }
    const address = /chicago|evanston/i.test(event.location) ? event.location : `${event.location}${event.region === 'chicago' ? ', Chicago, IL' : event.region === 'evanston' ? ', Evanston, IL' : ''}`
    groups.set(address, [...(groups.get(address) ?? []), event])
  }
  for (const [address, rows] of groups) {
    const existing = byAddress.get(address)
    let coordinates: Coordinates | null | undefined = existing
    const expires = existing?.expires_at ?? new Date(+now + 29 * 86400_000).toISOString()
    if (!coordinates) {
      if (report.warning || report.address_requests >= limit) { report.deferred += rows.length; continue }
      report.address_requests++
      if (!apply) continue
      try { coordinates = await locate(address, key!) }
      catch (error) {
        report.warning = error instanceof Error ? error.message : 'Coordinate lookup failed'
        report.deferred += rows.length
        continue
      }
    }
    if (!coordinates) { report.unresolved += rows.length; continue }
    if (apply) {
      const missing = rows.filter(row => {
        const saved = byEvent.get(row.id)
        return !saved || saved.coordinate_location !== row.location || saved.address_query !== address
      }).map(row => ({ event_id: row.id, coordinate_location: row.location!, address_query: address,
        latitude: coordinates.latitude, longitude: coordinates.longitude, place_id: coordinates.place_id, expires_at: expires }))
      for (let offset = 0; offset < missing.length; offset += 100) {
        const { error } = await client.from('event_coordinates').upsert(missing.slice(offset, offset + 100))
        if (error) throw new Error(`Coordinate write failed: ${error.code}`)
      }
    }
    report.located += rows.length
  }
  return report
}

async function main() {
  const { values } = parseArgs({ options: {
    apply: { type: 'boolean', default: false }, purge: { type: 'boolean', default: false },
    limit: { type: 'string', default: '500' },
  } })
  const url = process.env.SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !secret) throw new Error('Backend Supabase credentials required')
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  if (values.purge) {
    const { error } = await client.from('event_coordinates').delete().lte('expires_at', new Date().toISOString())
    if (error) throw new Error(`Coordinate cleanup failed: ${error.code}`)
    return
  }
  const report = await syncCoordinates(client, { apply: values.apply, limit: Number(values.limit), key: process.env.GOOGLE_GEOCODING_API_KEY })
  console.log(JSON.stringify(report))
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n## Event coordinates\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`)
  if (report.warning) process.exitCode = 1
}

if (import.meta.main) main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Coordinate lookup failed')
  process.exitCode = 1
})
