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
  external_id: string
  data: EventData
  // A canonical organizer URL can identify an event also listed in another feed.
  related_url: string | null
}

export interface SourceResult {
  items: Candidate[]
  warnings: string[]
}

export type FetchText = (url: string) => Promise<string>
