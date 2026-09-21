import { useQuery } from '@tanstack/react-query'
import type { Database } from './database.types'
import { matchesNothing, type EventFilters } from './filters'
import { queryEvents } from './eventQuery'
import { withinBounds, type MapBounds } from './geo'
import { demoMaps, locateDemoEvents } from './demoCoordinates'
import { supabase } from './supabase'
import { PAGE_SIZE, pageRange } from './pagination'

export type EventRow = Database['public']['Tables']['events']['Row']
export type EventListItem = Pick<
  EventRow,
  | 'id'
  | 'title'
  | 'cover_image_url'
  | 'start_time'
  | 'end_time'
  | 'location'
  | 'is_free'
  | 'fee_text'
  | 'category'
  | 'area'
  | 'region'
  | 'neighborhood'
  | 'is_cancelled'
  | 'is_all_day'
>

const LIST_COLUMNS =
  'id,title,cover_image_url,start_time,end_time,location,is_free,fee_text,category,area,region,neighborhood,is_cancelled,is_all_day'

export function useEvents(filters: EventFilters, page: number, bounds: MapBounds | null = null) {
  return useQuery({
    queryKey: ['events', filters, page, bounds],
    queryFn: async ({ signal }) => {
      // An empty selection in any filter can match nothing; skip the request.
      if (matchesNothing(filters)) return { items: [] as EventListItem[], total: 0, page: 1 }

      if (demoMaps && bounds) {
        const all = await fetchAllEvents(filters, signal)
        const { located } = await locateDemoEvents(all)
        const ids = new Set(located.filter(event => withinBounds(event.event_coordinates, bounds)).map(e => e.id))
        const matching = all.filter(e => ids.has(e.id))
        const currentPage = Math.min(page, Math.max(1, Math.ceil(matching.length / PAGE_SIZE)))
        return { items: matching.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE), total: matching.length, page: currentPage }
      }
      const query = queryEvents(supabase, filters, LIST_COLUMNS, bounds).abortSignal(signal).returns<EventListItem[]>()

      let result = await query.range(...pageRange(page))
      // Saved links can outlive events. Recover an out-of-range page rather than showing an error.
      const lastPage = Math.max(1, Math.ceil((result.count ?? 0) / PAGE_SIZE))
      const currentPage = result.error?.code === 'PGRST103' ? 1 : Math.min(page, lastPage)
      if (currentPage !== page && (!result.error || result.error.code === 'PGRST103')) {
        result = await query.range(...pageRange(currentPage))
      }
      const { data, error, count } = result

      if (error) throw error
      return {
        items: data satisfies EventListItem[],
        total: count ?? 0,
        page: currentPage,
      }
    },
  })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function useEvent(id: string | undefined) {
  return useQuery({
    queryKey: ['event', id],
    enabled: Boolean(id),
    queryFn: async () => {
      if (!id || !UUID.test(id)) return null
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

/** "Free", the listed price, or null when the source gave no price. */
export function feeLabel(event: Pick<EventRow, 'is_free' | 'fee_text'>): string | null {
  if (event.is_free) return 'Free'
  return event.fee_text?.trim() || null
}

export type MapEvent = { id: string; title: string; event_coordinates: { latitude: number; longitude: number } }

async function fetchAllEvents(filters: EventFilters, signal: AbortSignal) {
  const items: EventListItem[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await queryEvents(supabase, filters, LIST_COLUMNS).range(offset, offset + 499).abortSignal(signal).returns<EventListItem[]>()
    if (error) throw error
    items.push(...data)
    if (data.length < 500) return items
  }
}

export function useMapEvents(filters: EventFilters, bounds: MapBounds | null, enabled: boolean) {
  return useQuery({
    queryKey: ['map-events', filters, bounds], enabled, retry: false, staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      if (matchesNothing(filters)) return { located: [] as MapEvent[], deferred: 0, warning: '' }
      if (demoMaps) {
        const result = await locateDemoEvents(await fetchAllEvents(filters, signal))
        return { ...result, located: result.located.filter(event => withinBounds(event.event_coordinates, bounds)) }
      }
      const located: MapEvent[] = []
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await queryEvents(supabase, filters, 'id,title', bounds, true)
          .range(offset, offset + 499).abortSignal(signal).returns<MapEvent[]>()
        if (error) throw error
        located.push(...data)
        if (data.length < 500) return { located, deferred: 0, warning: '' }
      }
    },
  })
}

export function useSavedEventRows(ids: string[]) {
  return useQuery({
    queryKey: ['saved-events', ids],
    queryFn: async ({ signal }) => {
      const items: EventListItem[] = []
      for (let offset = 0; offset < ids.length; offset += 100) {
        const { data, error } = await supabase.from('events').select(LIST_COLUMNS)
          .eq('status', 'published').in('id', ids.slice(offset, offset + 100)).abortSignal(signal)
        if (error) throw error
        items.push(...data)
      }
      return items.sort((a, b) => a.start_time.localeCompare(b.start_time) || a.id.localeCompare(b.id))
    },
  })
}
