import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types.ts'
import { ALL_REGIONS, ALL_SCOPES, categoryClause, timeRanges, type EventFilters } from './filters.ts'
import type { MapBounds } from './geo.ts'

export function queryEvents(client: SupabaseClient<Database>, filters: EventFilters, options: {
  bounds?: MapBounds | null; pins?: boolean; ids?: string[]; group?: boolean
} = {}) {
  const categories = categoryClause(filters.categories)
  return client.rpc('browse_events', {
    p_ranges: timeRanges(filters, new Date()).map(r => ({ from: r.from.toISOString(), to: r.to?.toISOString() ?? null })),
    p_areas: filters.scopes.length < ALL_SCOPES.length ? filters.scopes : undefined,
    p_regions: filters.regions.length < ALL_REGIONS.length ? filters.regions : undefined,
    p_categories: categories.kind === 'some' ? categories.dbCategories : undefined,
    p_free: filters.freeOnly,
    p_term: filters.q.trim(),
    p_bounds: options.bounds ? { ...options.bounds } : undefined,
    p_located: options.pins ?? false,
    p_ids: options.ids,
    p_group: options.group ?? true,
  }, { count: 'exact' })
}
