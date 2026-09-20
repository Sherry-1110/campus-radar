import type { FetchText, SourceResult } from './types.ts'

// Load only the requested adapter; an adapter-specific load failure stays in its job.
// Each adapter owns parsing/pagination and can fetch only its explicitly allowed hosts.
export const sources: { id: string; name: string; hosts: string[]; fetch: (fetchText: FetchText) => Promise<SourceResult> }[] = [
  { id: 'planitpurple', name: 'PlanItPurple', hosts: ['planitpurple.northwestern.edu'], fetch: async f => (await import('./sources/planitpurple.ts')).fetchPlanItPurple(f) },
  { id: 'bienen', name: 'Bienen School of Music', hosts: ['www.music.northwestern.edu'], fetch: async f => (await import('./sources/bienen.ts')).fetchBienen(f) },
  { id: 'choose-chicago', name: 'Choose Chicago', hosts: ['www.choosechicago.com'], fetch: async f => (await import('./sources/choose-chicago.ts')).fetchChooseChicago(f) },
  { id: 'garage', name: 'The Garage', hosts: ['www.addevent.com'], fetch: async f => (await import('./sources/garage.ts')).fetchGarage(f) },
]
