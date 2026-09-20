import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface StateMessageProps {
  icon: LucideIcon
  title: string
  children?: ReactNode
  action?: ReactNode
  tone?: 'neutral' | 'error'
}

export function StateMessage({ icon: Icon, title, children, action, tone = 'neutral' }: StateMessageProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-dashed border-brand-200 bg-surface px-6 py-12 text-center"
    >
      <span
        className={`grid size-14 place-items-center rounded-2xl ${
          tone === 'error' ? 'bg-red-50 text-danger' : 'bg-brand-50 text-brand-600'
        }`}
      >
        <Icon className="size-7" aria-hidden="true" />
      </span>
      <h2 className="text-xl font-bold">{title}</h2>
      {children && <p className="text-ink-muted">{children}</p>}
      {action}
    </div>
  )
}

export const buttonPrimary =
  'inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-700 px-5 text-sm font-bold text-white motion-safe:transition hover:bg-brand-800'
export const buttonSecondary =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink motion-safe:transition hover:border-brand-300 hover:bg-brand-50'
