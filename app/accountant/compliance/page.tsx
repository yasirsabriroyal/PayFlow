import { Suspense } from 'react'
import { getComplianceDashboard } from './actions'
import { ComplianceDashboardClient } from './compliance-dashboard-client'
import { AppHeader } from '@/components/app-header'
import { RoleTabBar } from '@/components/role-tab-bar'

export const metadata = {
  title: 'Compliance Center | PayFlow',
  description: 'Monitor contractor compliance status, documents, and payment readiness.',
}

export default async function AccountantCompliancePage() {
  const result = await getComplianceDashboard()

  if (!result.success) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader pageTitle="Compliance Center" />
        <RoleTabBar role="accountant" />
        <main className="max-w-7xl mx-auto px-6 py-16 flex flex-col items-center justify-center text-center">
          <div className="w-14 h-14 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
            <span className="text-2xl">!</span>
          </div>
          <p className="font-semibold text-lg">Failed to load compliance data</p>
          <p className="text-sm text-muted-foreground mt-1">{result.error}</p>
        </main>
      </div>
    )
  }

  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background">
        <AppHeader pageTitle="Compliance Center" />
        <RoleTabBar role="accountant" />
        <main className="max-w-7xl mx-auto px-6 py-16 flex items-center justify-center">
          <p className="text-muted-foreground">Loading compliance data...</p>
        </main>
      </div>
    }>
      <ComplianceDashboardClient
        summary={result.summary}
        contractors={result.contractors}
        overrides={result.overrides}
        blockedPayments={result.blockedPayments}
      />
    </Suspense>
  )
}
