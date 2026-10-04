import { useCallback, useRef } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { selectEvent } from './selection'

export const isMobileViewport = () => window.matchMedia('(max-width: 639px)').matches

/**
 * On phones an event opens in a bottom sheet over the list (?event=<id>, so Back closes it).
 * On larger screens it opens as its own page.
 */
export function useEventSelection() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const returnFocus = useRef<HTMLElement | null>(null)
  const open = useCallback((id: string, trigger?: HTMLElement) => {
    if (!isMobileViewport()) return navigate(`/events/${id}`)
    if (trigger) returnFocus.current = trigger
    setParams(prev => selectEvent(prev, id), { replace: params.has('event'), state: { sheet: true }, preventScrollReset: true })
  }, [navigate, setParams, params])
  const close = useCallback(() => {
    // The sheet was pushed on top of the list, so closing it is going back.
    if (location.state?.sheet) navigate(-1)
    else setParams(prev => selectEvent(prev, null), { replace: true, preventScrollReset: true })
  }, [location.state, navigate, setParams])
  return { selectedId: params.get('event'), open, close, returnFocus }
}
