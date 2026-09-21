export interface MapBounds { south: number; west: number; north: number; east: number }
export const INITIAL_BOUNDS: MapBounds = { south: 41.72, west: -87.85, north: 42.10, east: -87.52 }

export function parseBounds(raw: string | null): MapBounds | null {
  if (!raw) return null
  const parts = raw.split(',')
  if (parts.length !== 4 || parts.some(value => !value.trim())) return null
  const [south, west, north, east] = parts.map(Number)
  if (![south, west, north, east].every(Number.isFinite) || south < -90 || north > 90 || west < -180 || east > 180 || south >= north || west >= east) return null
  return { south, west, north, east }
}

export function writeBounds({ south, west, north, east }: MapBounds): string {
  return [south, west, north, east].map(value => Number(value.toFixed(6))).join(',')
}

export function withinBounds(point: { latitude: number; longitude: number }, bounds: MapBounds | null): boolean {
  return !bounds || (point.latitude >= bounds.south && point.latitude <= bounds.north && point.longitude >= bounds.west && point.longitude <= bounds.east)
}
