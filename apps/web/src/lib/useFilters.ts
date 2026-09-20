import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { isCategory } from './categories'
import { WHEN_OPTIONS, type WhenFilter } from './dates'
import type { EventFilters } from './events'

const WHEN_VALUES = new Set<string>(WHEN_OPTIONS.map((o) => o.value))

export function useFilters() {
  const [params, setParams] = useSearchParams()

  const filters = useMemo<EventFilters>(() => {
    const category = params.get('category')
    const when = params.get('when') ?? 'any'
    return {
      q: params.get('q') ?? '',
      category: isCategory(category) ? category : null,
      when: (WHEN_VALUES.has(when) ? when : 'any') as WhenFilter,
      freeOnly: params.get('free') === '1',
    }
  }, [params])

  const update = useCallback(
    (patch: Partial<EventFilters>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          const set = (key: string, value: string | null) =>
            value ? next.set(key, value) : next.delete(key)
          if ('q' in patch) set('q', patch.q?.trim() || null)
          if ('category' in patch) set('category', patch.category ?? null)
          if ('when' in patch) set('when', patch.when && patch.when !== 'any' ? patch.when : null)
          if ('freeOnly' in patch) set('free', patch.freeOnly ? '1' : null)
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const clear = useCallback(() => setParams({}, { replace: true }), [setParams])

  const isFiltered =
    filters.q !== '' || filters.category !== null || filters.when !== 'any' || filters.freeOnly

  return { filters, update, clear, isFiltered }
}
