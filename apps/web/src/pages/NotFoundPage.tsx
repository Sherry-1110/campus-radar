import { SearchX } from 'lucide-react'
import { Link } from 'react-router'
import { buttonPrimary, StateMessage } from '@/components/StateMessage'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export function NotFoundPage() {
  useDocumentTitle('Page not found')
  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <StateMessage
        icon={SearchX}
        title="Page not found"
        action={
          <Link to="/" className={buttonPrimary}>
            Browse events
          </Link>
        }
      >
        That page doesn&rsquo;t exist.
      </StateMessage>
    </div>
  )
}
