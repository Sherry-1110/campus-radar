export type Category = 'arts' | 'music' | 'sports' | 'academic' | 'career' | 'social' | 'wellness' | 'food' | 'other'

export interface EventData {
  title: string
  description: string | null
  cover_image_url: string | null
  start_time: string
  end_time: string | null
  location: string | null
  location_url: string | null
  is_free: boolean
  fee_text: string | null
  category: Category
  is_cancelled: boolean
  is_all_day: boolean
  source_url: string
}

export interface Candidate {
  semantic?: import('./semantic.ts').Audit[]
  listing_url?: string
  enrichment?: { status: 'enriched' | 'unavailable'; fields: string[]; base: Record<string, string | null>; chain: string[] }
  external_id: string
  data: EventData
  // A canonical organizer URL can identify an event also listed in another feed.
  related_url: string | null
}

export interface SourceResult {
  semantic?: { mode:string; evaluation_passed:boolean; stats:Record<string,number>; samples:Array<{external_id:string;outcome:string;relationship?:string}> }
  details?: { checked: number; enriched: number; failed: number; skipped: number }
  items: Candidate[]
  warnings: string[]
}

export type FetchText = (url: string) => Promise<string>
