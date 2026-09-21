import { Radar } from 'lucide-react'
import { useEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { useSavedEvents } from '@/lib/useSavedEvents'

export function Layout() {
  const { pathname } = useLocation()
  const { ids, storageError } = useSavedEvents()

  useEffect(() => {
    window.scrollTo(0, 0)
    document.getElementById('main')?.focus({ preventScroll: true })
  }, [pathname])

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-white focus:px-4 focus:py-2 focus:font-semibold focus:shadow-card-hover"
      >
        Skip to content
      </a>

      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5" aria-label="Campus Radar home">
            <span className="grid size-9 place-items-center rounded-xl bg-brand-700 text-white">
              <Radar className="size-5" aria-hidden="true" />
            </span>
            <span className="text-lg font-extrabold tracking-tight text-brand-900">Campus Radar</span>
          </Link>
          <nav aria-label="Main navigation" className="flex items-center gap-2 sm:gap-5">
            <Link to="/" aria-current={pathname === '/' ? 'page' : undefined} className="min-h-11 content-center rounded-lg px-2 text-sm font-bold aria-[current=page]:text-brand-700">Explore</Link>
            <Link to="/saved" aria-current={pathname === '/saved' ? 'page' : undefined} className="min-h-11 content-center rounded-lg px-2 text-sm font-bold aria-[current=page]:text-brand-700">Saved{ids.length ? ` (${ids.length})` : ''}</Link>
          </nav>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        {storageError && <p role="status" className="bg-amber-50 px-4 py-2 text-center text-sm">Browser storage is unavailable. Saves will last only until this page closes.</p>}
        <Outlet />
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <p>Campus Radar · Events for Northwestern students. <Link to="/sources" className="underline hover:text-brand-700">Source status</Link></p>
          <p>An independent student project, not affiliated with Northwestern University.</p>
        </div>
      </footer>
    </div>
  )
}
