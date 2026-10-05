import { ArrowLeft, CloudOff, SearchX } from 'lucide-react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { EventDetail } from '@/components/EventDetail'
import { buttonPrimary, buttonSecondary, StateMessage } from '@/components/StateMessage'
import { useEvent } from '@/lib/events'
import { useLang } from '@/lib/i18n'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export function EventDetailPage() {
  const { id } = useParams()
  const { t } = useLang()
  const query = useEvent(id)
  useDocumentTitle(query.data?.title)

  const navigate = useNavigate()
  const location = useLocation()
  const goBack = () => {
    if (location.key !== 'default') navigate(-1)
    else navigate('/')
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <button type="button" onClick={goBack} className={`${buttonSecondary} mb-5`}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('Back to events')}
      </button>

      {query.isPending && <DetailSkeleton />}

      {query.isError && (
        <StateMessage
          icon={CloudOff}
          tone="error"
          title={t("Couldn't load this event")}
          action={
            <button type="button" onClick={() => query.refetch()} className={buttonPrimary}>
              {t('Try again')}
            </button>
          }
        >
          {t('Check your connection and try again.')}
        </StateMessage>
      )}

      {query.isSuccess && !query.data && (
        <StateMessage
          icon={SearchX}
          title={t('Event not found')}
          action={
            <Link to="/" className={buttonPrimary}>
              {t('Browse events')}
            </Link>
          }
        >
          {t('It may have been removed, or the link is wrong.')}
        </StateMessage>
      )}

      {query.data && <EventDetail event={query.data} />}
    </div>
  )
}


function DetailSkeleton() {
  return (
    <div className="grid gap-8 motion-safe:animate-pulse lg:grid-cols-[5fr_6fr]" aria-hidden="true">
      <div className="aspect-[4/5] rounded-3xl bg-brand-100" />
      <div className="flex flex-col gap-4">
        <div className="h-6 w-32 rounded-full bg-brand-100" />
        <div className="h-10 w-3/4 rounded bg-brand-100" />
        <div className="h-32 rounded-2xl bg-brand-50" />
        <div className="h-11 w-56 rounded-xl bg-brand-100" />
      </div>
    </div>
  )
}
