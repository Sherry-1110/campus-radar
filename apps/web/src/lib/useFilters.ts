import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { isDefaultFilters, parseFilters, updateFilterParams, type EventFilters } from './filters'

export function useFilters() {
  const [params, setParams] = useSearchParams()

  const filters = useMemo(() => parseFilters(params), [params])

  const update = useCallback(
    (patch: Partial<EventFilters>) => {
      setParams(prev => updateFilterParams(prev, patch), { replace: true })
    },
    [setParams],
  )

  const clear = useCallback(() => setParams({}, { replace: true }), [setParams])

  return { filters, update, clear, isFiltered: !isDefaultFilters(filters) }
}
