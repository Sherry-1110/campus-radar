import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
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

const PAGE_SIZE = 12
const LIST_COLUMNS =
  'id,title,cover_image_url,start_time,end_time,location,is_free,fee_text,category,area,neighborhood,is_cancelled,is_all_day'

export function useEvents(filters: EventFilters) {
  return useInfiniteQuery({
    queryKey: ['events', filters],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      // An empty selection in any filter can match nothing; skip the request.
      if (matchesNothing(filters)) return { items: [] as EventListItem[], next: null }

      const now = new Date()
      let query = supabase
        .from('events')
        .select(LIST_COLUMNS)
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

      const { data, error } = await query
        .order('start_time', { ascending: true })
        .order('id', { ascending: true })
        .range(pageParam, pageParam + PAGE_SIZE - 1)

      if (error) throw error
      return {
        items: data satisfies EventListItem[],
        next: data.length === PAGE_SIZE ? pageParam + PAGE_SIZE : null,
      }
    },
    getNextPageParam: (last) => last.next,
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
