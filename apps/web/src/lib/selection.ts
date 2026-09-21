export function selectEvent(params: URLSearchParams, id: string | null) {
  const next = new URLSearchParams(params)
  if (id) next.set('event', id)
  else next.delete('event')
  return next
}
