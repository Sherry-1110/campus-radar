import { Route, Routes } from 'react-router'
import { Layout } from '@/components/Layout'
import { EventDetailPage } from '@/pages/EventDetailPage'
import { HomePage } from '@/pages/HomePage'
import { SourcesPage } from '@/pages/SourcesPage'
import { NotFoundPage } from '@/pages/NotFoundPage'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="sources" element={<SourcesPage />} />
        <Route path="events/:id" element={<EventDetailPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
