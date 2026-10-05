import { useState } from 'react'
import { categoryMeta, type EventCategory } from '@/lib/categories'
import { useLang } from '@/lib/i18n'

// Northwestern's "N", as published by NU Athletics.
const NORTHWESTERN_LOGO = 'https://storage.googleapis.com/nusports-com-prod/2026/05/12/rhixKCMPlAkzlZYJGmBAPF08m3cnk3G1wMc1b0MX.png'

interface PosterProps {
  src: string | null
  title: string
  category: EventCategory
  className?: string
  natural?: boolean
  /** A Northwestern game: show the two teams' logos (src is the opponent's) instead of a poster. */
  matchup?: boolean
}

export function Poster({ src, title, category, className = '', natural = false, matchup = false }: PosterProps) {
  const { t } = useLang()
  const [failed, setFailed] = useState<string | null>(null)
  const meta = categoryMeta(category)
  const Icon = meta.icon

  if (matchup) {
    const badge = 'grid aspect-square w-[32%] place-items-center overflow-hidden rounded-2xl border border-line bg-white p-[6%] shadow-card'
    return (
      <div role="img" aria-label={t('Poster for {0}', title)}
        className={`${natural ? 'relative aspect-[4/3] w-full' : 'absolute inset-0'} flex items-center justify-center gap-[6%] bg-gradient-to-br from-brand-50 to-brand-100 ${className}`}>
        <span className={badge}><img src={NORTHWESTERN_LOGO} alt="" className="size-full min-h-0 object-contain" referrerPolicy="no-referrer" /></span>
        <span className="text-lg font-extrabold text-brand-700 sm:text-2xl" aria-hidden="true">vs</span>
        <span className={badge}>
          {src && failed !== src
            ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(src)} className="size-full min-h-0 object-contain" />
            : <Icon className="size-1/2 text-brand-600" aria-hidden="true" />}
        </span>
      </div>
    )
  }

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
      aria-label={meta.value === 'event' ? t('Event') : t('{0} event', t(meta.label))}
    >
      <Icon className="size-1/3 text-white/25" strokeWidth={1.25} aria-hidden="true" />
      <div className="absolute -right-8 -top-8 size-32 rounded-full bg-white/10" aria-hidden="true" />
      <div className="absolute -bottom-10 -left-6 size-28 rounded-full bg-white/10" aria-hidden="true" />
    </div>
  )
}
