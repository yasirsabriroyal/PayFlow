'use server'

import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { AppShell } from '@/components/layout/app-shell'
import { TemplateDetailClient } from './_client'
import type { ExpenseTemplateWithRelations } from '@/lib/recurring-expenses/types'

interface PageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from('expense_templates')
    .select('name')
    .eq('id', id)
    .single()
  return { title: data?.name ? `${data.name} — Recurring Expense` : 'Expense Template' }
}

export default async function TemplateDetailPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: userRow } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!userRow || !['admin', 'project_manager', 'accountant'].includes(userRow.role)) {
    redirect('/dashboard')
  }

  const { data: template, error } = await supabase
    .from('expense_templates')
    .select(`
      *,
      contractor:contractors(id, company_name, trade_category, vendor_type),
      category:contractor_categories(id, name),
      subcategory:contractor_subcategories(id, name),
      project:projects(id, name, project_number),
      schedule:expense_template_schedules(*),
      generation_log:recurring_generation_log(
        id, period_key, status, invoice_id, skip_reason, error_message, generated_at, triggered_by,
        invoice:invoices(id, invoice_number, amount, status)
      )
    `)
    .eq('id', id)
    .order('generated_at', { referencedTable: 'recurring_generation_log', ascending: false })
    .single()

  if (error || !template) notFound()

  const { data: suppliersRaw } = await supabase
    .from('contractors')
    .select('id, company_name, trade_category, vendor_type')
    .in('vendor_type', ['supplier', 'both'])
    .eq('status', 'active')
    .order('company_name')

  const { data: categoriesRaw } = await supabase
    .from('contractor_categories')
    .select('id, name')
    .order('name')

  const { data: projectsRaw } = await supabase
    .from('projects')
    .select('id, name, project_number')
    .in('status', ['active', 'planning'])
    .order('name')

  return (
    <AppShell
      title={template.name}
      subtitle="Expense Template"
      backHref="/admin/recurring-expenses"
      backLabel="Recurring Expenses"
    >
      <TemplateDetailClient
        template={template as unknown as ExpenseTemplateWithRelations}
        suppliers={suppliersRaw ?? []}
        categories={categoriesRaw ?? []}
        projects={projectsRaw ?? []}
        canEdit={userRow.role === 'admin'}
      />
    </AppShell>
  )
}
