import { useCallback, useRef } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { selectEvent } from './selection'

export const isMobileViewport = () => window.matchMedia('(max-width: 639px)').matches
/** Wide enough for the map and an event side by side. */
export const isWideViewport = () => window.matchMedia('(min-width: 1024px)').matches

/**
 * On phones an event opens in a bottom sheet over the list (?event=<id>, so Back closes it).
 * On larger screens it opens as its own page, except from the map, where it stays beside the map.
 */
export function useEventSelection() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const returnFocus = useRef<HTMLElement | null>(null)
  // Shows the event on this page (?event=<id>): a bottom sheet, or beside the map on wide screens.
  const show = useCallback((id: string, trigger?: HTMLElement) => {
    if (trigger) returnFocus.current = trigger
    setParams(prev => selectEvent(prev, id), { replace: params.has('event'), state: { sheet: true }, preventScrollReset: true })
  }, [setParams, params])
  const open = useCallback((id: string, trigger?: HTMLElement) => {
    if (!isMobileViewport()) return navigate(`/events/${id}`)
    show(id, trigger)
  }, [navigate, show])
  const close = useCallback(() => {
    // The sheet was pushed on top of the list, so closing it is going back.
    if (location.state?.sheet) navigate(-1)
    else setParams(prev => selectEvent(prev, null), { replace: true, preventScrollReset: true })
  }, [location.state, navigate, setParams])
  return { selectedId: params.get('event'), open, show, close, returnFocus }
}
