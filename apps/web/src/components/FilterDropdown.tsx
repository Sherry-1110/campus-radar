import { ChevronDown } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { allSelected, type FilterOption } from '@/lib/filters'

interface FilterDropdownProps<T extends string> {
  label: string
  options: FilterOption<T>[]
  selected: T[]
  onChange: (next: T[]) => void
  /** Overrides the text shown on the button. */
  summary?: string
  /** Tailwind classes that place the panel under the button. */
  panelClass?: string
  /** On phones show only the label, to keep the filter row short. */
  labelOnlyOnMobile?: boolean
  /** Marks the filter as changed from its default (a purple border and dot on phones). */
  changed?: boolean
  /** Extra content rendered under an option (for example a date input). */
  renderExtra?: (value: T) => ReactNode
}

function defaultSummary<T extends string>(options: FilterOption<T>[], selected: T[]): string {
  if (allSelected(selected, options.map((o) => o.value))) return 'All'
  if (selected.length === 0) return 'None'
  if (selected.length === 1) return options.find((o) => o.value === selected[0])?.label ?? '1 selected'
  return `${selected.length} selected`
}

export function FilterDropdown<T extends string>({
  label,
  options,
  selected,
  onChange,
  summary,
  panelClass = 'left-0',
  labelOnlyOnMobile = false,
  changed = false,
  renderExtra,
}: FilterDropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  // Open toward the right, or toward the left when that would run off the screen.
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!open || !panel) return
    panel.style.left = '0'; panel.style.right = 'auto'
    if (panel.getBoundingClientRect().right > window.innerWidth - 8) { panel.style.left = 'auto'; panel.style.right = '0' }
  }, [open])

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

  const values = options.map((o) => o.value)
  const everything = allSelected(selected, values)
  const partial = !everything && selected.length > 0

  const toggle = (value: T) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
        className={`flex min-h-11 w-full items-center max-sm:justify-center gap-1 rounded-xl border border-line bg-surface px-2 text-left text-[13px] shadow-card sm:gap-2 sm:px-3 sm:text-sm motion-safe:transition hover:border-brand-300 aria-expanded:border-brand-700 ${changed ? 'max-sm:border-brand-700 max-sm:bg-brand-50' : ''}`}
      >
        <span className="shrink-0 font-semibold text-ink-muted">{label}</span>
        {changed && <span className="size-2 shrink-0 rounded-full bg-brand-700 sm:hidden"><span className="sr-only">(changed)</span></span>}
        <span className={`min-w-0 flex-1 truncate font-bold text-ink ${labelOnlyOnMobile ? 'hidden sm:block' : ''}`}>
          {summary ?? defaultSummary(options, selected)}
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-ink-muted motion-safe:transition-transform sm:size-4 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="group"
          aria-label={label}
          className={`absolute z-30 mt-2 w-max min-w-full max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-2 shadow-card-hover ${panelClass}`}
        >
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 font-bold hover:bg-brand-50">
            <input
              type="checkbox"
              checked={everything}
              ref={(el) => {
                if (el) el.indeterminate = partial
              }}
              onChange={() => onChange(everything ? [] : values)}
              className="size-5 accent-brand-700"
            />
            All
          </label>
          <div className="my-1 border-t border-line" role="separator" />
          {options.map((o) => (
            <div key={o.value}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 hover:bg-brand-50">
                <input
                  type="checkbox"
                  checked={selected.includes(o.value)}
                  onChange={() => toggle(o.value)}
                  className="size-5 accent-brand-700"
                />
                {o.label}
              </label>
              {selected.includes(o.value) && renderExtra?.(o.value)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
