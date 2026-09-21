import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types.ts'
import { startOfChicagoDay } from './dates.ts'
import { ALL_REGIONS, ALL_SCOPES, categoryClause, timeRanges, type EventFilters } from './filters.ts'
import type { MapBounds } from './geo.ts'

export function queryEvents(client: SupabaseClient<Database>, filters: EventFilters, columns: string, bounds: MapBounds | null = null, pins = false) {
  const now = new Date()
  const selection = bounds || pins ? `${columns},event_coordinates!inner(latitude,longitude)` : columns
  let query = client.from('events').select(selection, { count: 'exact' }).eq('status', 'published')
    .gte('start_time', startOfChicagoDay(now).toISOString())
  const ranges = timeRanges(filters, now)
  if (!ranges.length) query = query.in('id', [])
  else if (!(ranges.length === 1 && ranges[0].to === null)) {
    query = query.or(ranges.map(r => r.to
      ? `and(start_time.gte.${r.from.toISOString()},start_time.lt.${r.to.toISOString()})`
      : `start_time.gte.${r.from.toISOString()}`).join(','))
  }
  if (filters.scopes.length < ALL_SCOPES.length) query = query.in('area', filters.scopes)
  if (filters.regions.length < ALL_REGIONS.length) query = query.in('region', filters.regions)
  const categories = categoryClause(filters.categories)
  if (categories.kind === 'some') query = query.in('category', categories.dbCategories)
  if (filters.freeOnly) query = query.eq('is_free', true)
  const term = filters.q.replace(/[,()"\\%*:]/g, ' ').replace(/\s+/g, ' ').trim()
  if (term) query = query.or(`title.ilike.*${term}*,search.wfts(english).${term}`)
  if (bounds) {
    query = query.gte('event_coordinates.latitude', bounds.south).lte('event_coordinates.latitude', bounds.north)
      .gte('event_coordinates.longitude', bounds.west).lte('event_coordinates.longitude', bounds.east)
  }
  return query.order('start_time', { ascending: true }).order('id', { ascending: true })
}
