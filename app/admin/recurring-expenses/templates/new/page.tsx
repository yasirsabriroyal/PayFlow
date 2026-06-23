import { Suspense } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { AppHeader } from '@/components/app-header'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { NewTemplateWizard } from './_wizard'

export const dynamic = 'force-dynamic'

async function getFormData() {
  const supabase = getSupabaseAdmin()

  const [vendorsRes, categoriesRes, projectsRes] = await Promise.all([
    supabase
      .from('contractors')
      .select('id, company_name, vendor_type, email')
      .in('status', ['active', 'pending_kyc'])
      .order('company_name'),
    supabase
      .from('contractor_categories')
      .select('id, name')
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('projects')
      .select('id, name, project_number')
      .eq('is_active', true)
      .order('name'),
  ])

  return {
    vendors: vendorsRes.data ?? [],
    categories: categoriesRes.data ?? [],
    projects: projectsRes.data ?? [],
  }
}

export default async function NewTemplatePage() {
  const { vendors, categories, projects } = await getFormData()

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        pageTitle="New Expense Template"
        pageDescription="Set up a recurring expense template with vendor, schedule, and approval settings"
        breadcrumbs={[
          { label: 'Admin', href: '/admin/dashboard' },
          { label: 'Recurring Expenses', href: '/admin/recurring-expenses' },
          { label: 'New Template' },
        ]}
      />

      <main className="container mx-auto px-4 py-6 md:px-6 md:py-8 max-w-3xl">
        <div className="mb-6">
          <Link
            href="/admin/recurring-expenses"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Recurring Expenses
          </Link>
        </div>
        <Suspense fallback={<div className="h-64 animate-pulse bg-muted rounded-xl" />}>
          <NewTemplateWizard
            vendors={vendors}
            categories={categories}
            projects={projects}
          />
        </Suspense>
      </main>
    </div>
  )
}
