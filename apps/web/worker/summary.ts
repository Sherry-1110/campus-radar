export interface Pick { id: string; title: string; start_time: string; is_all_day: boolean; location: string | null }

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/**
 * Plain HTML describing the site and this week's picks, for readers that do not run the app
 * (AI assistants, search engines, link checkers). The app replaces nothing here: it lives in <noscript>.
 */
export function summary(picks: Pick[]): string {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric' })
  const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })
  const seen = new Set<string>()
  const items = picks.filter(p => !seen.has(p.title) && seen.add(p.title)).slice(0, 10).map(p => {
    const when = day.format(new Date(p.start_time)) + (p.is_all_day ? '' : `, ${time.format(new Date(p.start_time))}`)
    return `<li><a href="/events/${encodeURIComponent(p.id)}">${escape(p.title)}</a> (${escape([when, p.location].filter(Boolean).join(' · '))})</li>`
  })
  return `<noscript>
<h1>Campus Radar</h1>
<p>Events at Northwestern and around Chicago in one place: concerts, games, art, fests, parties and more, gathered from PlanItPurple, the Bienen School of Music, NU Athletics and Choose Chicago.
Browse by Music, Arts, Sports, Activities, Fests or Parties; pick today, this weekend, the next 7 days or any dates; show only free or on-campus events; see them on a map; switch between English and Chinese.</p>
${items.length ? `<h2>This week's picks</h2>\n<ul>\n${items.join('\n')}\n</ul>\n` : ''}<p>Turn on JavaScript to browse every event.</p>
</noscript>`
}
