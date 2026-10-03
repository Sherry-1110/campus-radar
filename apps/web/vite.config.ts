import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { demoGeocode } from './src/lib/demoGeocoding.ts'

function demoGeocoding(): Plugin {
  return { name: 'local-demo-geocoding', apply: 'serve', configureServer(server) {
    const env = loadEnv(server.config.mode, server.config.envDir, 'VITE_')
    if (env.VITE_GOOGLE_MAPS_DEMO !== 'true') return
    server.middlewares.use('/api/demo/geocode', async (req, res) => {
      const response = await demoGeocode(new Request(new URL(req.url ?? '/', 'http://localhost'), { method: req.method }), env.VITE_GOOGLE_MAPS_API_KEY)
      res.statusCode = response.status
      response.headers.forEach((value, name) => res.setHeader(name, value))
      res.end(await response.text())
    })
  } }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), demoGeocoding(), cloudflare()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
