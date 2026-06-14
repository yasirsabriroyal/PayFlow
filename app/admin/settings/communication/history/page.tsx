import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'
import { History } from 'lucide-react'
import { CommunicationHistoryClient } from './communication-history-client'

export const metadata = {
  title: 'Communication History',
  description: 'Audit log of every email, SMS, and in-app notification sent to vendors and staff.',
}

export default function CommunicationHistoryPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        pageTitle="Communication History"
        breadcrumbs={[
          { label: 'Settings', href: '/admin/settings' },
          { label: 'Communication & Branding', href: '/admin/settings/communication' },
          { label: 'History' },
        ]}
      />
      <RoleTabBar role="admin" />

      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-2">
          <History className="w-6 h-6 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-900">Communication History</h1>
        </div>
        <p className="text-sm text-gray-500 mb-6 max-w-2xl">
          A complete delivery log of every transactional message. Track what was sent, to whom,
          which template version produced it, and whether the provider confirmed delivery.
        </p>

        <CommunicationHistoryClient />
      </div>
    </div>
  )
}
