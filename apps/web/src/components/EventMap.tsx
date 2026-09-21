import { LocateFixed, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { MapEvent } from '@/lib/events'
import { INITIAL_BOUNDS, parseBounds, writeBounds, type MapBounds } from '@/lib/geo'
import { loadGoogleMaps } from '@/lib/googleMaps'

export function EventMap({ events, selectedId, onSelect, bounds, onSearchArea, loading, error, deferred = 0 }: {
  events: MapEvent[]; selectedId: string | null; onSelect: (id: string, trigger?: HTMLElement) => void;
  bounds: MapBounds | null; onSearchArea: (bounds: MapBounds) => void;
  loading: boolean; error: boolean | string; deferred?: number;
}) {
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
        if (!firstIdle) setMoved(true)
        firstIdle = false
      })
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
      marker.addListener('click', () => { if (rows.length === 1) onSelect(rows[0].id, mapRegion.current ?? undefined); else setGroup(rows) })
      return marker
    })
    return () => markers.forEach(marker => { marker.map = null; google.maps.event.clearInstanceListeners(marker) })
  }, [map, events, selectedId, onSelect])

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

  return <section ref={mapRegion} tabIndex={-1} aria-label="Event map" className="event-map relative overflow-hidden rounded-2xl border border-line bg-brand-50">
    <div ref={canvas} className="absolute inset-0" />
    {!map && !message && <p role="status" className="absolute inset-x-4 top-20 rounded-xl bg-white p-4">Loading Google Maps…</p>}
    {map && <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
      <button type="button" onClick={nearMe} disabled={locating} className="map-control"><LocateFixed className="size-4" aria-hidden="true" />{locating ? 'Locating…' : 'Near me'}</button>
      {moved && draft && <button type="button" className="map-control bg-brand-700! text-white!" onClick={() => { onSearchArea(draft); setMoved(false); setGroup([]) }}>
        <Search className="size-4" aria-hidden="true" />Search this area</button>}
    </div>}
    {message && <div role="status" className="absolute inset-x-4 top-20 rounded-xl border border-line bg-white p-4 text-sm shadow-card">
      <p>{message}</p>{!map && import.meta.env.VITE_GOOGLE_MAPS_API_KEY && <button type="button" className="mt-2 underline" onClick={() => { setMessage(''); setAttempt(value => value + 1) }}>Try again</button>}
    </div>}
    {visibleGroup.length > 0 && <div className="absolute inset-x-4 top-20 max-h-64 overflow-auto rounded-xl border border-line bg-white p-3 shadow-card-hover">
      <div className="flex items-center justify-between"><p className="font-bold">At this venue</p><button type="button" aria-label="Close venue events" className="size-11" onClick={() => setGroup([])}><X className="mx-auto size-4" /></button></div>
      {visibleGroup.map(event => <button type="button" key={event.id} className="block min-h-11 w-full rounded-lg px-2 py-3 text-left text-sm hover:bg-brand-50" onClick={click => onSelect(event.id, click.currentTarget)}>{event.title}</button>)}
    </div>}
    {map && <p role="status" className="absolute inset-x-3 bottom-9 rounded-lg bg-white/95 px-3 py-2 text-xs text-ink-muted">
      {error ? `${events.length} mapped events. ${typeof error === 'string' ? error : 'Some event locations could not load.'} Clear the area filter to browse all cards.` : loading ? 'Finding event locations…' : `${events.length} mapped events${deferred ? ` · ${deferred} beyond the prototype lookup limit` : ' · Some venues may not be mapped'}`}
    </p>}
  </section>
}
