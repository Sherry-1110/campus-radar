import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { EventCategory } from './categories'
import type { WhenFilter } from './dates'
import { getRange } from './dates'
import type { Database } from './database.types'
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
>

export interface EventFilters {
  q: string
  category: EventCategory | null
  when: WhenFilter
  freeOnly: boolean
}

const PAGE_SIZE = 12
const LIST_COLUMNS =
  'id,title,cover_image_url,start_time,end_time,location,is_free,fee_text,category'
// Events without an end time count as "ongoing" for this long after they start.
const OPEN_ENDED_GRACE_MS = 2 * 60 * 60 * 1000

export function useEvents(filters: EventFilters) {
  return useInfiniteQuery({
    queryKey: ['events', filters],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { from, to } = getRange(filters.when, new Date())
      const fromIso = from.toISOString()
      const graceIso = new Date(from.getTime() - OPEN_ENDED_GRACE_MS).toISOString()

      let query = supabase
        .from('events')
        .select(LIST_COLUMNS, { count: 'exact' })
        .eq('status', 'published')
        .or(`end_time.gte.${fromIso},and(end_time.is.null,start_time.gte.${graceIso})`)

      if (to) query = query.lt('start_time', to.toISOString())
      if (filters.category) query = query.eq('category', filters.category)
      if (filters.freeOnly) query = query.eq('is_free', true)

      const term = filters.q.replace(/[,()"\\%*:]/g, ' ').replace(/\s+/g, ' ').trim()
      if (term) query = query.or(`title.ilike.*${term}*,search.wfts(english).${term}`)

      const { data, error, count } = await query
        .order('start_time', { ascending: true })
        .order('id', { ascending: true })
        .range(pageParam, pageParam + PAGE_SIZE - 1)

      if (error) throw error
      return {
        items: data satisfies EventListItem[],
        total: count ?? 0,
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
