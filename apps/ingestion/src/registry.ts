import type { FetchText, SourceResult } from './types.ts'

// Load only the requested adapter; an adapter-specific load failure stays in its job.
// Each adapter owns parsing/pagination and can fetch only its explicitly allowed hosts.
export const sources: { id: string; name: string; hosts: string[]; fetch: (fetchText: FetchText, now?: Date) => Promise<SourceResult> }[] = [
  { id: 'planitpurple', name: 'PlanItPurple', hosts: ['planitpurple.northwestern.edu'], fetch: async (f, now) => (await import('./sources/planitpurple.ts')).fetchPlanItPurple(f, now) },
  { id: 'bienen', name: 'Bienen School of Music', hosts: ['www.music.northwestern.edu'], fetch: async (f, now) => (await import('./sources/bienen.ts')).fetchBienen(f, now) },
  { id: 'choose-chicago', name: 'Choose Chicago', hosts: ['www.choosechicago.com'], fetch: async (f, now) => (await import('./sources/choose-chicago.ts')).fetchChooseChicago(f, now) },
  { id: 'garage', name: 'The Garage', hosts: ['www.addevent.com'], fetch: async (f, now) => (await import('./sources/garage.ts')).fetchGarage(f, now) },
  { id: 'chicago-roundups', name: 'Chicago roundups (curated)', hosts: ['www.choosechicago.com'], fetch: async (f, now) => (await import('./sources/chicago-roundups.ts')).fetchChicagoRoundups(f, now) },
  { id: 'nusports', name: 'NU Athletics', hosts: ['nusports.com'], fetch: async f => (await import('./sources/nusports.ts')).fetchNuSports(f) },
  { id: 'cats-on-campus', name: 'Cats on Campus', hosts: ['catsoncampus.northwestern.edu'], fetch: async (f, now) => (await import('./sources/cats-on-campus.ts')).fetchCatsOnCampus(f, now) },
  { id: 'downtown-evanston', name: 'Downtown Evanston', hosts: ['api.vibemap.com'], fetch: async (f, now) => (await import('./sources/downtown-evanston.ts')).fetchDowntownEvanston(f, now) },
  { id: 'space', name: 'SPACE', hosts: ['evanstonspace.com', 'static1.squarespace.com', 'static2.16oncenterchicago.com', 'app.ticketmaster.com'], fetch: async f => (await import('./sources/space.ts')).fetchSpace(f) },
  { id: 'do312', name: 'Do312', hosts: ['do312.com'], fetch: async (f, now) => (await import('./sources/do312.ts')).fetchDo312(f, now) },
  { id: 'second-city', name: 'The Second City', hosts: ['platform.secondcity.com'], fetch: async (f, now) => (await import('./sources/second-city.ts')).fetchSecondCity(f, now) },
]
