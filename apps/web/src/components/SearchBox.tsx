import { Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'

interface SearchBoxProps {
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
  /** Called after the user submits with Enter or the Search button. */
  onSubmitted?: () => void
}

export function SearchBox({ value, onChange, autoFocus, onSubmitted }: SearchBoxProps) {
  const [draft, setDraft] = useState(value)
  const [prevValue, setPrevValue] = useState(value)

  // Adopt external changes (e.g. "Clear filters") without an effect.
  if (value !== prevValue) {
    setPrevValue(value)
    setDraft(value)
  }

  useEffect(() => {
    if (draft === value) return
    const timer = setTimeout(() => onChange(draft), 350)
    return () => clearTimeout(timer)
  }, [draft, value, onChange])

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        onChange(draft)
        onSubmitted?.()
      }}
      className="flex w-full items-center gap-2 rounded-2xl border border-line bg-white p-1.5 shadow-card"
    >
      <label htmlFor="event-search" className="sr-only">
        Search events
      </label>
      <Search className="ml-3 size-5 shrink-0 text-ink-muted" aria-hidden="true" />
      <input
        id="event-search"
        autoFocus={autoFocus}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Search events…"
        className="min-h-11 min-w-0 flex-1 bg-transparent px-1 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {draft && (
        <button
          type="button"
          onClick={() => {
            setDraft('')
            onChange('')
          }}
          className="grid size-11 shrink-0 place-items-center rounded-xl text-ink-muted hover:bg-brand-50"
          aria-label="Clear search"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      )}
      <button
        type="submit"
        className="min-h-11 shrink-0 rounded-xl bg-brand-700 px-5 text-sm font-bold text-white motion-safe:transition hover:bg-brand-800"
      >
        Search
      </button>
    </form>
  )
}
