import { Search } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { SearchBox } from './SearchBox'

interface SearchToggleProps {
  value: string
  onChange: (value: string) => void
}

/** A search icon that opens the search field in a popover. */
export function SearchToggle({ value, onChange }: SearchToggleProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const active = value.trim() !== ''

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={active ? `Search events (searching for “${value.trim()}”)` : 'Search events'}
        onClick={() => setOpen((o) => !o)}
        className={`relative grid size-11 place-items-center rounded-xl border shadow-card motion-safe:transition ${
          active || open
            ? 'border-brand-700 bg-brand-50 text-brand-800'
            : 'border-line bg-surface text-ink hover:border-brand-300'
        }`}
      >
        <Search className="size-5" aria-hidden="true" />
        {active && (
          <span
            className="absolute right-1.5 top-1.5 size-2.5 rounded-full bg-brand-700 ring-2 ring-brand-50"
            aria-hidden="true"
          />
        )}
      </button>

      {open && (
        <div id={panelId} className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))]">
          <SearchBox value={value} onChange={onChange} autoFocus onSubmitted={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}
