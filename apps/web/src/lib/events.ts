import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { Database } from './database.types'
import { matchesNothing, type EventFilters } from './filters'
import { queryEvents } from './eventQuery'
import type { MapBounds } from './geo'
import { supabase } from './supabase'
import { startOfChicagoDay } from './dates'
import { pickFeatured, type FeaturedCandidate } from './recommend'
import { nextPage, pageRange } from './pagination'

export type EventRow = Database['public']['Tables']['events']['Row']
export type EventListItem = Pick<
  EventRow,
  | 'id'
  | 'series_id'
  | 'title'
  | 'title_zh'
  | 'cover_image_url'
  | 'start_time'
  | 'end_time'
  | 'location'
  | 'location_zh'
  | 'is_free'
  | 'fee_text'
  | 'category'
  | 'categories'
  | 'area'
  | 'region'
  | 'neighborhood'
  | 'is_cancelled'
  | 'is_all_day'
  | 'source_url'
  | 'more_info_url'
> & { matching_dates?: number; last_start_time?: string }

const LIST_COLUMNS =
  'id,series_id,title,title_zh,cover_image_url,start_time,end_time,location,location_zh,is_free,fee_text,category,categories,area,region,neighborhood,is_cancelled,is_all_day,source_url,more_info_url'

export function useEvents(filters: EventFilters, bounds: MapBounds | null = null) {
  return useInfiniteQuery({
    queryKey: ['event-feed', filters, bounds],
    initialPageParam: 1,
    getNextPageParam: nextPage,
    queryFn: async ({ signal, pageParam: page }) => {
      // An empty selection in any filter can match nothing; skip the request.
      if (matchesNothing(filters)) return { items: [] as EventListItem[], total: 0, page: 1 }

      const query = queryEvents(supabase, filters, { bounds })
        .abortSignal(signal).returns<Array<{ event: EventListItem }>>()

      const { data, error, count } = await query.range(...pageRange(page))
      // Imports/removals can shrink a feed while it is open. End it without losing earlier cards.
      if (error?.code === 'PGRST103') return { items: [] as EventListItem[], total: count ?? 0, page }

      if (error) throw error
      return {
        items: data.map(row => row.event),
        total: count ?? 0,
        page,
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

// browse_events returns the full list row for pins too, so the map can preview an event.
export type MapEvent = EventListItem & { event_coordinates: { latitude: number; longitude: number } }

export function useMapEvents(filters: EventFilters, bounds: MapBounds | null, enabled: boolean) {
  return useQuery({
    queryKey: ['map-events', filters, bounds], enabled, retry: false, staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      if (matchesNothing(filters)) return { located: [] as MapEvent[] }
      const located: MapEvent[] = []
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await queryEvents(supabase, filters, { bounds, pins: true })
          .range(offset, offset + 499).abortSignal(signal).returns<Array<{ event: MapEvent }>>()
        if (error) throw error
        located.push(...data.map(row => row.event))
        if (data.length < 500) return { located }
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

/** Occurrences stay individually addressable, including previously saved dates. */
export function useSeriesDates(seriesId: string | null) {
  return useQuery({
    queryKey: ['series-dates', seriesId], enabled: Boolean(seriesId),
    queryFn: async ({ signal }) => {
      const dates: Pick<EventRow, 'id' | 'start_time' | 'end_time' | 'is_all_day' | 'is_cancelled'>[] = []
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from('events').select('id,start_time,end_time,is_all_day,is_cancelled')
          .eq('status', 'published').eq('series_id', seriesId!)
          .gte('start_time', startOfChicagoDay(new Date()).toISOString())
          .order('start_time').order('id').range(offset, offset + 499).abortSignal(signal)
        if (error) throw error
        dates.push(...data)
        if (data.length < 500) return dates
      }
    },
  })
}

/** Upcoming events with posters that look big or special, for the home page strip. */
export function useFeaturedEvents() {
  return useQuery({
    queryKey: ['featured-events'], staleTime: 10 * 60_000,
    queryFn: async ({ signal }) => {
      const from = startOfChicagoDay(new Date())
      const candidates = () => supabase.from('events').select(`${LIST_COLUMNS},description,featured_rank`)
        .eq('status', 'published').eq('is_cancelled', false).eq('is_hidden', false).not('cover_image_url', 'is', null)
      const [upcoming, picked] = await Promise.all([
        candidates().gte('start_time', from.toISOString()).lt('start_time', new Date(from.getTime() + 14 * 86_400_000).toISOString())
          .order('start_time').limit(300).abortSignal(signal).returns<FeaturedCandidate[]>(),
        // Hand-picked events, including ones already under way.
        candidates().not('featured_rank', 'is', null).or(`start_time.gte.${from.toISOString()},end_time.gte.${new Date().toISOString()}`)
          .order('start_time').limit(100).abortSignal(signal).returns<FeaturedCandidate[]>(),
      ])
      if (upcoming.error) throw upcoming.error
      if (picked.error) throw picked.error
      const ids = new Set(picked.data.map(e => e.id))
      return pickFeatured([...picked.data, ...upcoming.data.filter(e => !ids.has(e.id))])
    },
  })
}
