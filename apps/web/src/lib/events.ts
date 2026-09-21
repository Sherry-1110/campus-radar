import { useQuery } from '@tanstack/react-query'
import type { Database } from './database.types'
import { startOfChicagoDay } from './dates'
import {
  ALL_REGIONS,
  ALL_SCOPES,
  categoryClause,
  matchesNothing,
  timeRanges,
  type EventFilters,
} from './filters'
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
  | 'neighborhood'
  | 'is_cancelled'
  | 'is_all_day'
>

const LIST_COLUMNS =
  'id,title,cover_image_url,start_time,end_time,location,is_free,fee_text,category,area,neighborhood,is_cancelled,is_all_day'

export function useEvents(filters: EventFilters, page: number) {
  return useQuery({
    queryKey: ['events', filters, page],
    queryFn: async ({ signal }) => {
      // An empty selection in any filter can match nothing; skip the request.
      if (matchesNothing(filters)) return { items: [] as EventListItem[], total: 0, page: 1 }

      const now = new Date()
      let query = supabase
        .from('events')
        .select(LIST_COLUMNS, { count: 'exact' })
        .eq('status', 'published')
        // Only today and later, by Chicago calendar date.
        .gte('start_time', startOfChicagoDay(now).toISOString())

      const ranges = timeRanges(filters, now)
      if (!(ranges.length === 1 && ranges[0].to === null)) {
        const clauses = ranges.map((r) => {
          const from = `start_time.gte.${r.from.toISOString()}`
          return r.to ? `and(${from},start_time.lt.${r.to.toISOString()})` : from
        })
        query = query.or(clauses.join(','))
      }

      if (filters.scopes.length < ALL_SCOPES.length) query = query.in('area', filters.scopes)
      if (filters.regions.length < ALL_REGIONS.length) query = query.in('region', filters.regions)

      const categories = categoryClause(filters.categories)
      if (categories.kind === 'some') query = query.in('category', categories.dbCategories)
      if (filters.freeOnly) query = query.eq('is_free', true)

      const term = filters.q.replace(/[,()"\\%*:]/g, ' ').replace(/\s+/g, ' ').trim()
      if (term) query = query.or(`title.ilike.*${term}*,search.wfts(english).${term}`)

      query = query
        .order('start_time', { ascending: true })
        .order('id', { ascending: true })
        .abortSignal(signal)

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
        .select('*, event_sources(source_url, sources(name, url))')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function feeLabel(event: Pick<EventRow, 'is_free' | 'fee_text'>): string {
  if (event.is_free) return 'Free'
  return event.fee_text?.trim() || 'See details'
}
