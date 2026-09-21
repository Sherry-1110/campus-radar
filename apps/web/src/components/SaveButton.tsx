import { Bookmark } from 'lucide-react'
import { useSavedEvents } from '@/lib/useSavedEvents'

export function SaveButton({ id, title }: { id: string; title: string }) {
  const { ids, toggle } = useSavedEvents()
  const saved = ids.includes(id)
  return <button type="button" aria-label={`${saved ? 'Unsave' : 'Save'} ${title}`} aria-pressed={saved}
    onClick={() => toggle(id)} className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-line bg-surface px-3 text-sm font-bold text-brand-700 hover:bg-brand-50">
    <Bookmark className={`size-4 ${saved ? 'fill-current' : ''}`} aria-hidden="true" />
    <span>{saved ? 'Saved' : 'Save'}</span>
  </button>
}
