import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { geocodeAddress } from './src/lib/geocoding.js'

function demoGeocoding(): Plugin {
  return { name: 'local-demo-geocoding', apply: 'serve', configureServer(server) {
    const env = loadEnv(server.config.mode, server.config.envDir, 'VITE_')
    if (env.VITE_GOOGLE_MAPS_DEMO !== 'true') return
    const cache = new Map<string, ReturnType<typeof geocodeAddress>>()
    server.middlewares.use('/__demo/geocode', async (req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-store')
      const address = new URL(req.url ?? '/', 'http://localhost').searchParams.get('address')?.trim()
      if (req.method !== 'GET' || !address || address.length > 400) { res.statusCode = 400; res.end('{"error":"Invalid address"}'); return }
      if (!env.VITE_GOOGLE_MAPS_API_KEY) { res.statusCode = 503; res.end('{"error":"Demo map key is not configured"}'); return }
      if (!cache.has(address) && cache.size >= 50) { res.statusCode = 429; res.end('{"error":"Prototype lookup limit reached"}'); return }
      try {
        if (!cache.has(address)) cache.set(address, geocodeAddress(address, env.VITE_GOOGLE_MAPS_API_KEY))
        res.end(JSON.stringify(await cache.get(address)))
      } catch (error) {
        cache.delete(address)
        res.statusCode = error instanceof Error && error.message === 'Google Geocoding HTTP 429' ? 429 : 502
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Coordinate lookup failed' }))
      }
    })
  } }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), demoGeocoding(), cloudflare()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
