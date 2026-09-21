/// <reference types="google.maps" />
let loading: Promise<void> | undefined
declare global {
  interface Window { campusRadarMapReady?: () => void; gm_authFailure?: () => void }
}

export function loadGoogleMaps(): Promise<void> {
  if (loading) return loading
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  if (!key) return Promise.reject(new Error('Map is not available yet. You can still browse and save events.'))
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    const timeout = window.setTimeout(() => fail(), 20000)
    function fail() {
      window.clearTimeout(timeout)
      script.remove()
      loading = undefined
      reject(new Error('Google Maps could not load. Please try again.'))
    }
    window.campusRadarMapReady = () => { window.clearTimeout(timeout); resolve() }
    window.gm_authFailure = fail
    script.async = true
    script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({ key, loading: 'async', callback: 'campusRadarMapReady', v: 'weekly', libraries: 'marker' })}`
    script.onerror = fail
    document.head.append(script)
  })
  return loading
}
