import { Clock, LocateFixed, MapPin, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { posterMeta } from '@/lib/categories'
import { formatDateRange, formatWhenShort } from '@/lib/dates'
import type { MapEvent } from '@/lib/events'
import { isAthleticsGame } from '@/lib/eventSource'
import { INITIAL_BOUNDS, parseBounds, writeBounds, type MapBounds } from '@/lib/geo'
import { loadGoogleMaps } from '@/lib/googleMaps'
import { localized, useLang } from '@/lib/i18n'
import { cardPlace } from '@/lib/place'
import { isWideViewport } from '@/lib/useEventSelection'
import { CategoryChips } from './CategoryChip'
import { Poster } from './Poster'

const PREVIEW_WIDTH = 300

export function EventMap({ events, selectedId, onSelect, bounds, onSearchArea, loading, error }: {
  events: MapEvent[]; selectedId: string | null; onSelect: (id: string, trigger?: HTMLElement) => void;
  bounds: MapBounds | null; onSearchArea: (bounds: MapBounds) => void;
  loading: boolean; error: boolean | string;
}) {
  const { lang, t } = useLang()
  const canvas = useRef<HTMLDivElement>(null)
  const mapRegion = useRef<HTMLElement>(null)
  const initial = useRef(bounds ?? INITIAL_BOUNDS)
  const [map, setMap] = useState<google.maps.Map | null>(null)
  const [draft, setDraft] = useState<MapBounds | null>(null)
  const [moved, setMoved] = useState(false)
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [group, setGroup] = useState<MapEvent[]>([])
  const [locating, setLocating] = useState(false)
  // The card shown while the mouse rests on a pin, placed above it (or below, near the top edge).
  const [preview, setPreview] = useState<{ event: MapEvent; x: number; y: number; below: boolean } | null>(null)
  // Moves made by the page itself should not offer "Search this area".
  const panning = useRef(false)
  const visibleGroup = group.filter(row => events.some(event => event.id === row.id))

  useEffect(() => {
    let canceled = false
    let instance: google.maps.Map | undefined
    let idle: google.maps.MapsEventListener | undefined
    let resize: ResizeObserver | undefined
    loadGoogleMaps().then(() => {
      if (canceled || !canvas.current) return
      instance = new google.maps.Map(canvas.current, {
        mapId: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID',
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
        gestureHandling: 'cooperative', clickableIcons: false,
        center: { lat: 41.93, lng: -87.68 }, zoom: 10,
      })
      instance.fitBounds(initial.current, 32)
      let firstIdle = true
      idle = instance.addListener('idle', () => {
        const visible = instance?.getBounds()?.toJSON()
        if (!visible || !parseBounds(writeBounds(visible))) return
        setDraft(visible)
        if (!firstIdle && !panning.current) setMoved(true)
        firstIdle = panning.current = false
      })
      instance.addListener('bounds_changed', () => setPreview(null))
      instance.addListener('dragstart', () => { panning.current = false })
      resize = new ResizeObserver(() => { if (instance) google.maps.event.trigger(instance, 'resize') })
      resize.observe(canvas.current)
      setMap(instance)
    }).catch(error => { if (!canceled) setMessage(error.message) })
    return () => { canceled = true; idle?.remove(); resize?.disconnect(); if (instance) google.maps.event.clearInstanceListeners(instance) }
  }, [attempt])

  useEffect(() => {
    if (!map) return
    const groups = new Map<string, MapEvent[]>()
    for (const event of events) {
      const point = event.event_coordinates
      const key = `${point.latitude},${point.longitude}`
      groups.set(key, [...(groups.get(key) ?? []), event])
    }
    const hoverable = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const markers = [...groups.values()].map(rows => {
      const point = rows[0].event_coordinates
      const active = rows.some(row => row.id === selectedId)
      const pin = document.createElement('span')
      pin.className = `event-pin ${active ? 'is-selected' : ''}`
      pin.textContent = rows.length > 1 ? String(rows.length) : '●'
      const marker = new google.maps.marker.AdvancedMarkerElement({ map,
        position: { lat: point.latitude, lng: point.longitude }, content: pin,
        title: rows.length === 1 ? rows[0].title : `${rows.length} events at this venue`, zIndex: active ? 10 : 1,
      })
      // The open event needs no preview; the cursor often still rests on its pin after the click.
      if (hoverable && rows.length === 1 && rows[0].id !== selectedId) {
        pin.addEventListener('mouseenter', () => {
          const box = mapRegion.current?.getBoundingClientRect(), at = pin.getBoundingClientRect()
          if (!box) return
          const x = Math.min(Math.max(at.left + at.width / 2 - box.left, PREVIEW_WIDTH / 2 + 8), box.width - PREVIEW_WIDTH / 2 - 8)
          setPreview({ event: rows[0], x, y: at.top - box.top, below: at.top - box.top < 190 })
        })
        pin.addEventListener('mouseleave', () => setPreview(null))
      }
      marker.addListener('click', () => { setPreview(null); if (rows.length === 1) onSelect(rows[0].id, mapRegion.current ?? undefined); else setGroup(rows) })
      return marker
    })
    return () => { setPreview(null); markers.forEach(marker => { marker.map = null; google.maps.event.clearInstanceListeners(marker) }) }
  }, [map, events, selectedId, onSelect])

  // On smaller screens the event opens over the lower half: bring the map to the top and its pin above the sheet.
  useEffect(() => {
    const event = events.find(row => row.id === selectedId)
    if (!map || !event || isWideViewport() || !mapRegion.current) return
    const top = mapRegion.current.getBoundingClientRect().top
    // Instant, so the map's new position can be measured right away (the page otherwise scrolls smoothly).
    if (Math.abs(top) > 8) window.scrollBy({ top: top - 8, behavior: 'instant' })
    const box = mapRegion.current.getBoundingClientRect()
    const visibleMiddle = (Math.max(box.top, 0) + window.innerHeight / 2) / 2 - box.top
    panning.current = true
    map.panTo({ lat: event.event_coordinates.latitude, lng: event.event_coordinates.longitude })
    map.panBy(0, box.height / 2 - visibleMiddle)
    // Only the selection should move the map, not later refreshes of the event list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, selectedId])

  function nearMe() {
    if (!navigator.geolocation) { setMessage('Your browser does not support location. You can move the map instead.'); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(position => {
      setLocating(false)
      setMessage('')
      map?.panTo({ lat: position.coords.latitude, lng: position.coords.longitude })
      map?.setZoom(13)
    }, () => { setLocating(false); setMessage('Location unavailable. You can move the map instead.') }, { timeout: 10000, maximumAge: 60000 })
  }

  return <section ref={mapRegion} tabIndex={-1} aria-label={t('Event map')} className="event-map relative overflow-hidden rounded-2xl border border-line bg-brand-50">
    <div ref={canvas} className="absolute inset-0" />
    {!map && !message && <p role="status" className="absolute inset-x-4 top-20 rounded-xl bg-white p-4">{t('Loading Google Maps…')}</p>}
    {map && <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
      <button type="button" onClick={nearMe} disabled={locating} className="map-control"><LocateFixed className="size-4" aria-hidden="true" />{locating ? t('Locating…') : t('Near me')}</button>
      {moved && draft && <button type="button" className="map-control bg-brand-700! text-white!" onClick={() => { onSearchArea(draft); setMoved(false); setGroup([]) }}>
        <Search className="size-4" aria-hidden="true" />{t('Search this area')}</button>}
    </div>}
    {message && <div role="status" className="absolute inset-x-4 top-20 rounded-xl border border-line bg-white p-4 text-sm shadow-card">
      <p>{message}</p>{!map && import.meta.env.VITE_GOOGLE_MAPS_API_KEY && <button type="button" className="mt-2 underline" onClick={() => { setMessage(''); setAttempt(value => value + 1) }}>{t('Try again')}</button>}
    </div>}
    {visibleGroup.length > 0 && <div className="absolute inset-x-4 top-20 max-h-64 overflow-auto rounded-xl border border-line bg-white p-3 shadow-card-hover">
      <div className="flex items-center justify-between"><p className="font-bold">{t('At this venue')}</p><button type="button" aria-label={t('Close venue events')} className="size-11" onClick={() => setGroup([])}><X className="mx-auto size-4" /></button></div>
      <ul className="divide-y divide-line/70">
        {visibleGroup.map(event => {
          const Icon = posterMeta(event).icon
          return <li key={event.id}>
            <button type="button" className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 py-3 text-left text-sm hover:bg-brand-50 ${event.id === selectedId ? 'font-bold text-brand-700' : ''}`} onClick={click => onSelect(event.id, click.currentTarget)}>
              <Icon className="size-4 shrink-0 text-brand-700" aria-hidden="true" />
              <span className="min-w-0">{localized(lang, event.title, event.title_zh)}</span>
            </button>
          </li>
        })}
      </ul>
    </div>}
    {preview && <MapPreview {...preview} />}
    {map && (loading || error) && <p role="status" className="absolute inset-x-3 bottom-9 rounded-lg bg-white/95 px-3 py-2 text-xs text-ink-muted">
      {error ? `${typeof error === 'string' ? error : 'Some event locations could not load.'} Clear the area filter to browse all cards.` : 'Loading event locations…'}
    </p>}
  </section>
}

/** A small card for the event under the mouse; the pin itself is what gets clicked. */
function MapPreview({ event, x, y, below }: { event: MapEvent; x: number; y: number; below: boolean }) {
  const { lang, t } = useLang()
  const title = localized(lang, event.title, event.title_zh)
  const range = (event.matching_dates ?? 1) > 1 && event.last_start_time ? formatDateRange(event.start_time, event.last_start_time, 'short') : null
  const place = cardPlace({ ...event, location: localized(lang, event.location ?? '', event.location_zh) || null }, t) ?? t('Location not listed')
  return <div role="tooltip" className="pointer-events-none absolute z-20 flex overflow-hidden rounded-xl border border-line bg-surface shadow-card-hover"
    style={{ left: x, top: below ? y + 40 : y - 10, width: PREVIEW_WIDTH, transform: `translate(-50%, ${below ? '0' : '-100%'})` }}>
    <div className="relative min-h-28 w-28 shrink-0 bg-brand-50">
      <Poster src={event.cover_image_url} title={title} category={event.category} matchup={isAthleticsGame(event)} />
    </div>
    <div className="flex min-w-0 flex-col gap-1 p-3">
      <p className="line-clamp-2 text-sm font-bold leading-snug">{title}</p>
      <p className="flex items-start gap-1.5 text-xs text-ink-muted"><Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>{range ?? formatWhenShort(event.start_time, event.end_time, event.is_all_day)}</span></p>
      <p className="flex items-start gap-1.5 text-xs text-ink-muted"><MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span className="line-clamp-1">{place}</span></p>
      <CategoryChips event={event} />
    </div>
  </div>
}
