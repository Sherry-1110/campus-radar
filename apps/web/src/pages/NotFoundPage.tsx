import { SearchX } from 'lucide-react'
import { Link } from 'react-router'
import { buttonPrimary, StateMessage } from '@/components/StateMessage'
import { useLang } from '@/lib/i18n'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export function NotFoundPage() {
  const { t } = useLang()
  useDocumentTitle(t('Page not found'))
  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <StateMessage
        icon={SearchX}
        title={t('Page not found')}
        action={
          <Link to="/" className={buttonPrimary}>
            {t('Browse events')}
          </Link>
        }
      >
        {t('That page doesn’t exist.')}
      </StateMessage>
    </div>
  )
}
