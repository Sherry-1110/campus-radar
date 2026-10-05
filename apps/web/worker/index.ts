import { summary, type Pick } from './summary.ts'

const SUPABASE = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

/** Hand-picked events still to come, cached at the edge for 10 minutes. */
async function picks(): Promise<Pick[]> {
  const now = new Date()
  // Rounded to the hour so the cached request URL repeats.
  now.setUTCMinutes(0, 0, 0)
  const query = new URLSearchParams({
    select: 'id,title,start_time,is_all_day,location',
    featured_rank: 'not.is.null', status: 'eq.published', is_hidden: 'eq.false', is_cancelled: 'eq.false',
    or: `(start_time.gte.${now.toISOString()},end_time.gte.${now.toISOString()})`,
    order: 'start_time', limit: '40',
  })
  const response = await fetch(`${SUPABASE}/rest/v1/events?${query}`, {
    headers: { apikey: KEY, authorization: `Bearer ${KEY}` },
    cf: { cacheTtl: 600, cacheEverything: true },
  })
  return response.ok ? response.json() : []
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname !== '/') return new Response(null, { status: 404 })
    const page = await env.ASSETS.fetch(request)
    // The page must load even if the database is slow or down.
    const list = await Promise.race([picks().catch(() => []), new Promise<Pick[]>(r => setTimeout(() => r([]), 1500))])
    return new HTMLRewriter().on('body', { element: body => { body.append(summary(list), { html: true }) } }).transform(page)
  },
} satisfies ExportedHandler<Env>;
