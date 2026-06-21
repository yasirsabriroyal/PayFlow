import { Suspense } from 'react'
import Link from 'next/link'
import { Plus, RefreshCw } from 'lucide-react'
import { AppHeader } from '@/components/app-header'
import { Button } from '@/components/ui/button'
import {
  getTemplateDashboardStats,
  listExpenseTemplates,
  getUpcomingGenerations,
} from '@/lib/recurring-expenses/actions'
import { RecurringDashboardStats } from './_components/dashboard-stats'
import { RecurringTemplateTable } from './_components/template-table'
import { UpcomingGenerationsList } from './_components/upcoming-generations'

export const dynamic = 'force-dynamic'

export default async function RecurringExpensesPage() {
  const [stats, templates, upcoming] = await Promise.all([
    getTemplateDashboardStats(),
    listExpenseTemplates(),
    getUpcomingGenerations(30),
  ])

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        pageTitle="Recurring Expenses"
        pageDescription="Manage expense templates, supplier schedules, and automated invoice generation"
        breadcrumbs={[
          { label: 'Admin', href: '/admin/dashboard' },
          { label: 'Recurring Expenses' },
        ]}
      />

      <main className="container mx-auto px-4 py-6 md:px-6 md:py-8 space-y-8">
        {/* Header actions */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Overview</h2>
            <p className="text-sm text-muted-foreground">
              Automated expenses across all active schedules
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/recurring-expenses/templates">
                <RefreshCw className="w-4 h-4 mr-2" />
                All Templates
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/admin/recurring-expenses/templates/new">
                <Plus className="w-4 h-4 mr-2" />
                New Template
              </Link>
            </Button>
          </div>
        </div>

        {/* Stat cards */}
        <Suspense fallback={<div className="h-28 animate-pulse bg-muted rounded-xl" />}>
          <RecurringDashboardStats stats={stats} />
        </Suspense>

        {/* Two-column: Upcoming + Template table */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Upcoming generations — 1/3 width */}
          <div className="xl:col-span-1">
            <Suspense fallback={<div className="h-64 animate-pulse bg-muted rounded-xl" />}>
              <UpcomingGenerationsList items={upcoming} />
            </Suspense>
          </div>

          {/* Template table — 2/3 width */}
          <div className="xl:col-span-2">
            <Suspense fallback={<div className="h-64 animate-pulse bg-muted rounded-xl" />}>
              <RecurringTemplateTable templates={templates} />
            </Suspense>
          </div>
        </div>
      </main>
    </div>
  )
}
