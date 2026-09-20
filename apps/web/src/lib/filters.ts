import { CATEGORY_GROUPS, type CategoryGroup, type DbCategory } from './categoryGroups.ts'
import { chicagoMidnight, startOfChicagoDay, zonedParts } from './dates.ts'

export type ScopeValue = 'campus' | 'nearby'
export type TimeValue = 'today' | 'week' | 'month' | 'custom'
export type CategoryValue = CategoryGroup
export type RegionValue = 'evanston' | 'chicago' | 'between' | 'other'

export interface FilterOption<T extends string> {
  value: T
  label: string
}

export const SCOPE_OPTIONS: FilterOption<ScopeValue>[] = [
  { value: 'campus', label: 'On campus' },
  { value: 'nearby', label: 'Nearby' },
]

export const TIME_OPTIONS: FilterOption<TimeValue>[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom date' },
]

export const CATEGORY_OPTIONS: FilterOption<CategoryValue>[] = CATEGORY_GROUPS.map((g) => ({
  value: g.value,
  label: g.label,
}))

export const REGION_OPTIONS: FilterOption<RegionValue>[] = [
  { value: 'evanston', label: 'Evanston' },
  { value: 'chicago', label: 'Chicago' },
  { value: 'between', label: 'In between' },
  { value: 'other', label: 'Other' },
]

const values = <T extends string>(options: FilterOption<T>[]) => options.map((o) => o.value)

export const ALL_SCOPES = values(SCOPE_OPTIONS)
export const ALL_TIMES = values(TIME_OPTIONS)
export const ALL_CATEGORIES = values(CATEGORY_OPTIONS)
export const ALL_REGIONS = values(REGION_OPTIONS)

/**
 * Every filter is a multi-select. Selecting every option is the same as "All"
 * (no restriction); selecting none matches nothing.
 */
export interface EventFilters {
  q: string
  scopes: ScopeValue[]
  time: TimeValue[]
  /** YYYY-MM-DD, used when `time` includes "custom". */
  date: string | null
  categories: CategoryValue[]
  regions: RegionValue[]
  /** Only show free events (a restriction on top of the other filters). */
  freeOnly: boolean
}

export const DEFAULT_FILTERS: EventFilters = {
  q: '',
  scopes: ALL_SCOPES,
  time: ALL_TIMES,
  date: null,
  categories: ALL_CATEGORIES,
  regions: ALL_REGIONS,
  freeOnly: false,
}

const isAll = <T extends string>(selected: readonly T[], all: readonly T[]) =>
  all.every((v) => selected.includes(v))

function parseList<T extends string>(raw: string | null, all: readonly T[]): T[] {
  if (raw === null) return [...all]
  if (raw === 'none') return []
  const wanted = new Set(raw.split(','))
  const picked = all.filter((v) => wanted.has(v))
  return picked.length > 0 ? picked : [...all]
}

function serializeList<T extends string>(selected: readonly T[], all: readonly T[]): string | null {
  if (isAll(selected, all)) return null
  if (selected.length === 0) return 'none'
  return all.filter((v) => selected.includes(v)).join(',')
}

export function parseDateParam(raw: string | null): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const [y, m, d] = raw.split('-').map(Number)
  const check = new Date(Date.UTC(y, m - 1, d))
  const valid = check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d
  return valid ? raw : null
}

export function parseFilters(params: URLSearchParams): EventFilters {
  return {
    q: params.get('q') ?? '',
    scopes: parseList(params.get('from'), ALL_SCOPES),
    time: parseList(params.get('time'), ALL_TIMES),
    date: parseDateParam(params.get('date')),
    categories: parseList(params.get('cat'), ALL_CATEGORIES),
    regions: parseList(params.get('loc'), ALL_REGIONS),
    freeOnly: params.get('free') === '1',
  }
}

/** Writes filters back to URL params; anything at its default is omitted. */
export function writeFilters(filters: EventFilters): URLSearchParams {
  const params = new URLSearchParams()
  const set = (key: string, value: string | null) => {
    if (value) params.set(key, value)
  }
  set('q', filters.q.trim() || null)
  set('from', serializeList(filters.scopes, ALL_SCOPES))
  set('time', serializeList(filters.time, ALL_TIMES))
  set('date', filters.time.includes('custom') ? filters.date : null)
  set('cat', serializeList(filters.categories, ALL_CATEGORIES))
  set('loc', serializeList(filters.regions, ALL_REGIONS))
  set('free', filters.freeOnly ? '1' : null)
  return params
}

export function isDefaultFilters(filters: EventFilters): boolean {
  return writeFilters(filters).size === 0
}

/** True when some filter has nothing selected, so no event can match. */
export function matchesNothing(filters: EventFilters): boolean {
  return (
    filters.scopes.length === 0 ||
    filters.regions.length === 0 ||
    filters.categories.length === 0 ||
    filters.time.length === 0
  )
}

export interface DateRange {
  from: Date
  /** Exclusive; null means open-ended. */
  to: Date | null
}

/**
 * Time ranges to match, in Chicago time. Events before the start of today are
 * never shown. Overlapping presets (today ⊂ this week ⊂ this month) are merged.
 */
export function timeRanges(filters: Pick<EventFilters, 'time' | 'date'>, now: Date): DateRange[] {
  const today = startOfChicagoDay(now)
  if (isAll(filters.time, ALL_TIMES)) return [{ from: today, to: null }]

  const p = zonedParts(now)
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()
  const day = (offset: number) => chicagoMidnight(p.year, p.month, p.day + offset)
  const ranges: DateRange[] = []

  if (filters.time.includes('today')) ranges.push({ from: today, to: day(1) })
  if (filters.time.includes('week')) {
    // Calendar week, Monday to Sunday.
    const untilNextMonday = (8 - dow) % 7 || 7
    ranges.push({ from: today, to: day(untilNextMonday) })
  }
  if (filters.time.includes('month')) {
    ranges.push({ from: today, to: chicagoMidnight(p.year, p.month + 1, 1) })
  }
  if (filters.time.includes('custom') && filters.date) {
    const [y, m, d] = filters.date.split('-').map(Number)
    const from = chicagoMidnight(y, m, d)
    const to = chicagoMidnight(y, m, d + 1)
    if (to > today) ranges.push({ from: from > today ? from : today, to })
  }

  ranges.sort((a, b) => a.from.getTime() - b.from.getTime())
  const merged: DateRange[] = []
  for (const r of ranges) {
    const last = merged.at(-1)
    if (last && last.to !== null && r.from <= last.to) {
      if (r.to === null || r.to > last.to) last.to = r.to
    } else {
      merged.push({ ...r })
    }
  }
  return merged
}

export type CategoryClause = { kind: 'all' } | { kind: 'some'; dbCategories: DbCategory[] }

export function categoryClause(selected: readonly CategoryValue[]): CategoryClause {
  if (isAll(selected, ALL_CATEGORIES)) return { kind: 'all' }
  const dbCategories = CATEGORY_GROUPS.filter((g) => selected.includes(g.value)).flatMap((g) => g.members)
  return { kind: 'some', dbCategories }
}

export function allSelected<T extends string>(selected: readonly T[], all: readonly T[]): boolean {
  return isAll(selected, all)
}
