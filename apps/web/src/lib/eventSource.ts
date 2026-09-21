type SourceEvent = {
  source_url: string | null
  event_sources?: { source_url: string | null; sources: { name: string; url: string | null } | null }[]
}

export function eventSource(event: SourceEvent) {
  const listing = event.event_sources?.find(s => s.source_url || s.sources?.url)
  const url = event.source_url || listing?.source_url || listing?.sources?.url
  if (!url) return null
  const source = event.event_sources?.find(s => (s.source_url || s.sources?.url) === url)
  return { url, name: source?.sources?.name || new URL(url).hostname.replace(/^www\./, '') }
}
