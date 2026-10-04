import { Heart } from 'lucide-react'
import { useSavedEvents } from '@/lib/useSavedEvents'

/**
 * Floats on a poster. Icon-only on cards, where it appears on hover (always on touch
 * screens and once saved); with `label` it is a permanent "Save" pill, used on the detail page.
 */
export function SaveButton({ id, title, label = false }: { id: string; title: string; label?: boolean }) {
  const { ids, toggle } = useSavedEvents()
  const saved = ids.includes(id)
  const shape = label ? 'min-h-11 gap-1.5 px-4 text-sm font-bold'
    : `size-11 ${saved ? '' : 'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100'}`
  return <button type="button" aria-label={`${saved ? 'Unsave' : 'Save'} ${title}`} aria-pressed={saved}
    onClick={() => toggle(id)}
    className={`inline-flex items-center justify-center rounded-full border border-line bg-brand-50/70 text-brand-700 shadow-card backdrop-blur-sm hover:bg-brand-50/90 ${shape}`}>
    <Heart className={`size-5 ${saved ? 'fill-current' : ''}`} aria-hidden="true" />
    {label && <span>{saved ? 'Saved' : 'Save'}</span>}
  </button>
}
