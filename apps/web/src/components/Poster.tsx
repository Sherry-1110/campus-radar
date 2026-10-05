import { useState } from 'react'
import { categoryMeta, type EventCategory } from '@/lib/categories'
import { useLang } from '@/lib/i18n'

interface PosterProps {
  src: string | null
  title: string
  category: EventCategory
  className?: string
  natural?: boolean
}

export function Poster({ src, title, category, className = '', natural = false }: PosterProps) {
  const { t } = useLang()
  const [failed, setFailed] = useState<string | null>(null)
  const meta = categoryMeta(category)
  const Icon = meta.icon

  if (src && failed !== src) {
    return (
      <img
        src={src}
        alt={t('Poster for {0}', title)}
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
      aria-label={t('{0} event', t(meta.label))}
    >
      <Icon className="size-1/3 text-white/25" strokeWidth={1.25} aria-hidden="true" />
      <div className="absolute -right-8 -top-8 size-32 rounded-full bg-white/10" aria-hidden="true" />
      <div className="absolute -bottom-10 -left-6 size-28 rounded-full bg-white/10" aria-hidden="true" />
    </div>
  )
}
