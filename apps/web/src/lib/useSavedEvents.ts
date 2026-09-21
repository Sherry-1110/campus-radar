import { useSyncExternalStore } from 'react'
import { createSavedStore, SAVED_KEY } from './savedEvents'

const store = createSavedStore(() => window.localStorage)
window.addEventListener('storage', event => { if (event.key === SAVED_KEY || event.key === null) store.refresh() })

export function useSavedEvents() {
  return { ...useSyncExternalStore(store.subscribe, store.getSnapshot), toggle: store.toggle }
}
