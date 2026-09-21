import { useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router'
import { selectEvent } from './selection'

export function useEventSelection() {
  const [params, setParams] = useSearchParams()
  const returnFocus = useRef<HTMLElement | null>(null)
  const open = useCallback((id: string, trigger?: HTMLElement) => {
    if (trigger) returnFocus.current = trigger
    setParams(prev => selectEvent(prev, id), { replace: params.has('event'), preventScrollReset: true })
  }, [setParams, params])
  const close = useCallback(() => {
    setParams(prev => selectEvent(prev, null), { replace: true, preventScrollReset: true })
  }, [setParams])
  return { selectedId: params.get('event'), open, close, returnFocus }
}
