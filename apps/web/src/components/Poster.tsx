import { useState } from 'react'
import { categoryMeta, type EventCategory } from '@/lib/categories'

interface PosterProps {
  src: string | null
  title: string
  category: EventCategory
  className?: string
  natural?: boolean
}

export function Poster({ src, title, category, className = '', natural = false }: PosterProps) {
  const [failed, setFailed] = useState<string | null>(null)
  const meta = categoryMeta(category)
  const Icon = meta.icon

  if (src && failed !== src) {
    return (
      <img
        src={src}
        alt={`Poster for ${title}`}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(src)}
        className={`${natural ? 'block h-auto w-full' : 'absolute inset-0 h-full w-full object-contain'} ${className}`}
      />
    )
  }

  return (
    <div
      className={`${natural ? 'relative aspect-[4/3] w-full' : 'absolute inset-0'} flex items-center justify-center overflow-hidden bg-gradient-to-br ${meta.gradient} ${className}`}
      role="img"
      aria-label={`${meta.label} event`}
    >
      <Icon className="size-1/3 text-white/25" strokeWidth={1.25} aria-hidden="true" />
      <div className="absolute -right-8 -top-8 size-32 rounded-full bg-white/10" aria-hidden="true" />
      <div className="absolute -bottom-10 -left-6 size-28 rounded-full bg-white/10" aria-hidden="true" />
    </div>
  )
}
