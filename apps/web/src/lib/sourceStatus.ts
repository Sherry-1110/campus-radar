export function sourceStatus(active: boolean, health: { status: string; started_at: string; last_success_at: string | null } | undefined, now = Date.now()) {
  if (!active) return 'Paused'
  if (!health) return 'Awaiting first run'
  if (health.status === 'running') return now - Date.parse(health.started_at) > 60 * 60_000 ? 'Stalled' : 'Running'
  if (health.status === 'failed') return 'Failed'
  return !health.last_success_at || now - Date.parse(health.last_success_at) > 36 * 60 * 60_000 ? 'Overdue' : 'Healthy'
}
