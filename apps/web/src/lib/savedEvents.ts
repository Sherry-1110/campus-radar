import { chicagoDateString } from './dates.ts'

export const SAVED_KEY = 'campus-radar:saved:v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function readSavedIds(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]')
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && UUID.test(id)))] : []
  } catch { return [] }
}

export function createSavedStore(storage: () => Pick<Storage, 'getItem' | 'setItem'>) {
  let snapshot = { ids: [] as string[], storageError: false }
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach(listener => listener())
  const refresh = () => {
    try { snapshot = { ids: readSavedIds(storage().getItem(SAVED_KEY)), storageError: false } }
    catch { snapshot = { ...snapshot, storageError: true } }
    notify()
  }
  refresh()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    refresh,
    toggle: (id: string) => {
      if (!UUID.test(id)) return
      // Read other tabs' latest values before applying this local change.
      if (!snapshot.storageError) refresh()
      const ids = snapshot.ids.includes(id) ? snapshot.ids.filter(value => value !== id) : [...snapshot.ids, id]
      let storageError = false
      try { storage().setItem(SAVED_KEY, JSON.stringify(ids)) } catch { storageError = true }
      snapshot = { ids, storageError }
      notify()
    },
  }
}

export function isPastEvent(event: { start_time: string; end_time: string | null; is_all_day: boolean }, now: Date): boolean {
  if (event.is_all_day) return chicagoDateString(new Date(event.end_time ?? event.start_time)) < chicagoDateString(now)
  if (event.end_time) return Date.parse(event.end_time) <= +now
  return chicagoDateString(new Date(event.start_time)) < chicagoDateString(now)
}
