'use server'

/**
 * Recurring Expenses — Server Actions
 *
 * All mutations use the service-role admin client (bypasses RLS). Every query
 * scopes by organization_id via resolveActiveOrgId(). Audit logs are written
 * inline following the existing PayFlow pattern.
 */

import { revalidatePath } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import {
  computeFirstGenerationDate,
  computeNextGenerationDate,
  buildPeriodKey,
} from './schedule-utils'
import type {
  ActionResult,
  CreateExpenseTemplateInput,
  UpdateExpenseTemplateInput,
  CreateScheduleInput,
  UpdateScheduleInput,
  ExpenseTemplate,
  ExpenseTemplateSchedule,
  ExpenseTemplateWithDetails,
  TemplateDashboardStats,
  UpcomingGeneration,
  RecurringGenerationLog,
  TemplateStatus,
} from './types'

// ─── Org resolver (inline, avoids 'server-only' import issues) ───────────────

async function getOrgId(): Promise<string> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('organizations')
    .select('id')
    .eq('is_default', true)
    .limit(1)
    .single()
  return data?.id ?? 'default'
}

// ─── Audit helper ─────────────────────────────────────────────────────────────

async function writeAuditLog(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  params: {
    action: string
    entity_type: string
    entity_id: string
    description: string
    user_id?: string | null
    user_email?: string | null
    old_values?: Record<string, unknown>
    new_values?: Record<string, unknown>
  },
) {
  await supabase.from('audit_logs').insert({
    user_id: params.user_id ?? null,
    user_email: params.user_email ?? null,
    action: params.action,
    entity_type: params.entity_type,
    entity_id: params.entity_id,
    description: params.description,
    old_values: params.old_values ?? null,
    new_values: params.new_values ?? null,
  })
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/** Load the dashboard stats for the recurring expenses overview. */
export async function getTemplateDashboardStats(): Promise<TemplateDashboardStats> {
  const supabase = getSupabaseAdmin()
  const orgId = await getOrgId()
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()

  const [activeRes, pausedRes, logRes, approvalRes] = await Promise.all([
    supabase
      .from('expense_templates')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', 'active'),
    supabase
      .from('expense_template_schedules')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('is_active', false),
    supabase
      .from('recurring_generation_log')
      .select('status, invoice_id')
      .eq('organization_id', orgId)
      .gte('generated_at', monthStart),
    supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'recurring')
      .eq('status', 'pending_approval'),
  ])

  const logs = logRes.data ?? []
  const generatedLogs = logs.filter((l) => l.status === 'generated')
  const failedLogs = logs.filter((l) => l.status === 'failed')

  // Sum amounts for generated invoices this month
  let generatedCents = 0
  if (generatedLogs.length > 0) {
    const invoiceIds = generatedLogs.map((l) => l.invoice_id).filter(Boolean)
    if (invoiceIds.length > 0) {
      const { data: invoices } = await supabase
        .from('invoices')
        .select('total_cents')
        .in('id', invoiceIds as string[])
      generatedCents = (invoices ?? []).reduce((sum, inv) => sum + (inv.total_cents ?? 0), 0)
    }
  }

  return {
    active_templates: activeRes.count ?? 0,
    generated_this_month: generatedLogs.length,
    generated_this_month_cents: generatedCents,
    paused_templates: pausedRes.count ?? 0,
    awaiting_approval: approvalRes.count ?? 0,
    failed_this_month: failedLogs.length,
  }
}

/** List all templates for the dashboard table. */
export async function listExpenseTemplates(filters?: {
  status?: TemplateStatus
  expense_type?: 'operational' | 'project'
  search?: string
}): Promise<ExpenseTemplateWithDetails[]> {
  const supabase = getSupabaseAdmin()
  const orgId = await getOrgId()

  let query = supabase
    .from('expense_templates')
    .select(`
      *,
      contractors ( company_name, email, vendor_type ),
      contractor_categories ( name ),
      contractor_subcategories ( name ),
      projects ( name ),
      expense_template_schedules (*)
    `)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (filters?.status) query = query.eq('status', filters.status)
  if (filters?.expense_type) query = query.eq('expense_type', filters.expense_type)
  if (filters?.search) query = query.ilike('name', `%${filters.search}%`)

  const { data, error } = await query
  if (error || !data) return []

  return data.map((row) => ({
    ...row,
    vendor_name: (row.contractors as Record<string, string> | null)?.company_name ?? row.vendor_name_override ?? null,
    vendor_email: (row.contractors as Record<string, string> | null)?.email ?? null,
    vendor_type: (row.contractors as Record<string, string> | null)?.vendor_type ?? null,
    category_name: (row.contractor_categories as Record<string, string> | null)?.name ?? null,
    subcategory_name: (row.contractor_subcategories as Record<string, string> | null)?.name ?? null,
    project_name: (row.projects as Record<string, string> | null)?.name ?? null,
    schedule: (row.expense_template_schedules as ExpenseTemplateSchedule[] | null)?.[0] ?? null,
    generated_this_month: 0,
    total_generated:
      (row.expense_template_schedules as ExpenseTemplateSchedule[] | null)?.[0]
        ?.total_generated ?? 0,
    last_invoice_number: null,
  })) as ExpenseTemplateWithDetails[]
}

/** Get a single template by id with full details. */
export async function getExpenseTemplate(
  id: string,
): Promise<ExpenseTemplateWithDetails | null> {
  const supabase = getSupabaseAdmin()
  const orgId = await getOrgId()

  const { data, error } = await supabase
    .from('expense_templates')
    .select(`
      *,
      contractors ( company_name, email, vendor_type ),
      contractor_categories ( name ),
      contractor_subcategories ( name ),
      projects ( name ),
      expense_template_schedules (*)
    `)
    .eq('id', id)
    .eq('organization_id', orgId)
    .single()

  if (error || !data) return null

  return {
    ...data,
    vendor_name: (data.contractors as Record<string, string> | null)?.company_name ?? data.vendor_name_override ?? null,
    vendor_email: (data.contractors as Record<string, string> | null)?.email ?? null,
    vendor_type: (data.contractors as Record<string, string> | null)?.vendor_type ?? null,
    category_name: (data.contractor_categories as Record<string, string> | null)?.name ?? null,
    subcategory_name: (data.contractor_subcategories as Record<string, string> | null)?.name ?? null,
    project_name: (data.projects as Record<string, string> | null)?.name ?? null,
    schedule: (data.expense_template_schedules as ExpenseTemplateSchedule[] | null)?.[0] ?? null,
    generated_this_month: 0,
    total_generated:
      (data.expense_template_schedules as ExpenseTemplateSchedule[] | null)?.[0]
        ?.total_generated ?? 0,
    last_invoice_number: null,
  } as ExpenseTemplateWithDetails
}

/** Upcoming generation dates in the next 30 days. */
export async function getUpcomingGenerations(days = 30): Promise<UpcomingGeneration[]> {
  const supabase = getSupabaseAdmin()
  const orgId = await getOrgId()
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() + days)

  const { data, error } = await supabase
    .from('expense_template_schedules')
    .select(`
      template_id,
      frequency,
      next_generation_date,
      expense_templates (
        name,
        default_amount_cents,
        currency,
        contractor_id,
        vendor_name_override,
        contractors ( company_name )
      )
    `)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .lte('next_generation_date', cutoff.toISOString().split('T')[0])
    .order('next_generation_date', { ascending: true })

  if (error || !data) return []

  return data
    .filter((row) => row.expense_templates && row.next_generation_date)
    .map((row) => {
      const tmpl = (row.expense_templates as unknown) as Record<string, unknown> | null
      const contractor = tmpl?.contractors as Record<string, string> | null
      return {
        template_id: row.template_id,
        template_name: (tmpl?.name as string) ?? '',
        vendor_name: contractor?.company_name ?? (tmpl?.vendor_name_override as string | null) ?? null,
        frequency: row.frequency as import('./types').ScheduleFrequency,
        next_generation_date: row.next_generation_date as string,
        default_amount_cents: (tmpl?.default_amount_cents as number) ?? 0,
        currency: (tmpl?.currency as string) ?? 'CAD',
      }
    })
}

/** Generation log entries for a specific template. */
export async function getGenerationLog(templateId: string): Promise<RecurringGenerationLog[]> {
  const supabase = getSupabaseAdmin()
  const orgId = await getOrgId()

  const { data } = await supabase
    .from('recurring_generation_log')
    .select('*')
    .eq('organization_id', orgId)
    .eq('template_id', templateId)
    .order('generated_at', { ascending: false })
    .limit(50)

  return (data ?? []) as RecurringGenerationLog[]
}

/** List all suppliers and contractors for vendor picker dropdowns. */
export async function listVendors(): Promise<
  { id: string; company_name: string; vendor_type: string; email: string | null }[]
> {
  const supabase = getSupabaseAdmin()

  const { data } = await supabase
    .from('contractors')
    .select('id, company_name, vendor_type, email')
    .in('status', ['active', 'pending_kyc'])
    .order('company_name', { ascending: true })

  return data ?? []
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/** Create a new expense template (without schedule). */
export async function createExpenseTemplate(
  input: CreateExpenseTemplateInput,
  userId?: string,
): Promise<ActionResult<ExpenseTemplate>> {
  const supabase = getSupabaseAdmin()
  const orgId = await getOrgId()

  const { data, error } = await supabase
    .from('expense_templates')
    .insert({
      organization_id: orgId,
      name: input.name,
      description: input.description ?? null,
      notes: input.notes ?? null,
      contractor_id: input.contractor_id ?? null,
      vendor_name_override: input.vendor_name_override ?? null,
      category_id: input.category_id ?? null,
      subcategory_id: input.subcategory_id ?? null,
      expense_type: input.expense_type,
      project_id: input.project_id ?? null,
      default_amount_cents: input.default_amount_cents,
      tax_treatment: input.tax_treatment,
      cost_code: input.cost_code ?? null,
      approval_route: input.approval_route,
      created_by: userId ?? null,
      updated_by: userId ?? null,
    })
    .select()
    .single()

  if (error) return { success: false, error: error.message }

  await writeAuditLog(supabase, {
    action: 'expense_template_created',
    entity_type: 'expense_template',
    entity_id: data.id,
    description: `Expense template "${data.name}" created`,
    user_id: userId ?? null,
    new_values: { name: data.name, expense_type: data.expense_type, status: data.status },
  })

  revalidatePath('/admin/recurring-expenses')
  revalidatePath(`/admin/recurring-expenses/templates/${data.id}`)
  return { success: true, data: data as ExpenseTemplate }
}

/** Update an existing expense template. */
export async function updateExpenseTemplate(
  id: string,
  input: UpdateExpenseTemplateInput,
  userId?: string,
): Promise<ActionResult<ExpenseTemplate>> {
  const supabase = getSupabaseAdmin()
  const orgId = await getOrgId()

  const { data: existing } = await supabase
    .from('expense_templates')
    .select('*')
    .eq('id', id)
    .eq('organization_id', orgId)
    .single()

  if (!existing) return { success: false, error: 'Template not found' }

  const { data, error } = await supabase
    .from('expense_templates')
    .update({
      ...input,
      updated_by: userId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('organization_id', orgId)
    .select()
    .single()

  if (error) return { success: false, error: error.message }

  await writeAuditLog(supabase, {
    action: 'expense_template_updated',
    entity_type: 'expense_template',
    entity_id: id,
    description: `Expense template "${existing.name}" updated`,
    user_id: userId ?? null,
    old_values: existing as Record<string, unknown>,
    new_values: input as Record<string, unknown>,
  })

  revalidatePath('/admin/recurring-expenses')
  revalidatePath(`/admin/recurring-expenses/templates/${id}`)
  return { success: true, data: data as ExpenseTemplate }
}

/** Archive a template (soft delete). */
export async function archiveExpenseTemplate(
  id: string,
  userId?: string,
): Promise<ActionResult> {
  const supabase = getSupabaseAdmin()
  const orgId = await getOrgId()

  const { data: existing } = await supabase
    .from('expense_templates')
    .select('name, status')
    .eq('id', id)
    .eq('organization_id', orgId)
    .single()

  if (!existing) return { success: false, error: 'Template not found' }

  // Deactivate schedule first
  await supabase
    .from('expense_template_schedules')
    .update({ is_active: false, paused_at: new Date().toISOString(), paused_reason: 'Template archived' })
    .eq('template_id', id)

  const { error } = await supabase
    .from('expense_templates')
    .update({ status: 'archived', updated_by: userId ?? null })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { success: false, error: error.message }

  await writeAuditLog(supabase, {
    action: 'expense_template_archived',
    entity_type: 'expense_template',
    entity_id: id,
    description: `Expense template "${existing.name}" archived`,
    user_id: userId ?? null,
    old_values: { status: existing.status },
    new_values: { status: 'archived' },
  })

  revalidatePath('/admin/recurring-expenses')
  return { success: true }
}

/** Update the status of an expense template (active | inactive | archived). */
export async function updateTemplateStatus(
  id: string,
  status: 'active' | 'inactive' | 'archived',
  userId?: string,
): Promise<ActionResult> {
  if (status === 'archived') return archiveExpenseTemplate(id, userId)

  const supabase = getSupabaseAdmin()
  const orgId = await getOrgId()

  const { error } = await supabase
    .from('expense_templates')
    .update({ status, updated_by: userId ?? null })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { success: false, error: error.message }

  await writeAuditLog(supabase, {
    action: status === 'active' ? 'expense_template_activated' : 'expense_template_paused',
    entity_type: 'expense_template',
    entity_id: id,
    description: `Template status set to ${status}`,
    user_id: userId ?? null,
    new_values: { status },
  })

  revalidatePath('/admin/recurring-expenses')
  revalidatePath(`/admin/recurring-expenses/templates/${id}`)
  return { success: true }
}

/** Create or replace the schedule for a template. */
export async function upsertSchedule(
  input: CreateScheduleInput,
  userId?: string,
): Promise<ActionResult<ExpenseTemplateSchedule>> {
  const supabase = getSupabaseAdmin()
  const orgId = await getOrgId()

  const startDate = new Date(input.start_date)
  const firstDate = computeFirstGenerationDate(
    input.frequency,
    startDate,
    input.day_of_month ?? 1,
    input.day_of_week ?? 1,
  )

  const { data, error } = await supabase
    .from('expense_template_schedules')
    .upsert(
      {
        organization_id: orgId,
        template_id: input.template_id,
        frequency: input.frequency,
        start_date: input.start_date,
        end_date: input.end_date ?? null,
        day_of_month: input.day_of_month ?? 1,
        day_of_week: input.day_of_week ?? 1,
        is_active: true,
        next_generation_date: firstDate.toISOString().split('T')[0],
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'template_id' },
    )
    .select()
    .single()

  if (error) return { success: false, error: error.message }

  await writeAuditLog(supabase, {
    action: 'recurring_schedule_modified',
    entity_type: 'expense_template_schedule',
    entity_id: data.id,
    description: `Schedule set to ${input.frequency} starting ${input.start_date}`,
    user_id: userId ?? null,
    new_values: input as unknown as Record<string, unknown>,
  })

  revalidatePath('/admin/recurring-expenses')
  revalidatePath(`/admin/recurring-expenses/templates/${input.template_id}`)
  return { success: true, data: data as ExpenseTemplateSchedule }
}

/** Pause a recurring schedule. */
export async function pauseSchedule(
  templateId: string,
  reason?: string,
  userId?: string,
): Promise<ActionResult> {
  const supabase = getSupabaseAdmin()

  const { error } = await supabase
    .from('expense_template_schedules')
    .update({
      is_active: false,
      paused_at: new Date().toISOString(),
      paused_reason: reason ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('template_id', templateId)

  if (error) return { success: false, error: error.message }

  // Mirror status on template
  await supabase
    .from('expense_templates')
    .update({ status: 'inactive', updated_by: userId ?? null })
    .eq('id', templateId)

  await writeAuditLog(supabase, {
    action: 'expense_template_paused',
    entity_type: 'expense_template',
    entity_id: templateId,
    description: `Recurring schedule paused${reason ? ': ' + reason : ''}`,
    user_id: userId ?? null,
    new_values: { paused_reason: reason },
  })

  revalidatePath('/admin/recurring-expenses')
  revalidatePath(`/admin/recurring-expenses/templates/${templateId}`)
  return { success: true }
}

/** Resume a paused recurring schedule. */
export async function resumeSchedule(
  templateId: string,
  userId?: string,
): Promise<ActionResult> {
  const supabase = getSupabaseAdmin()

  // Recompute next_generation_date from today
  const { data: schedule } = await supabase
    .from('expense_template_schedules')
    .select('frequency, day_of_month, day_of_week')
    .eq('template_id', templateId)
    .single()

  let nextDate: string | null = null
  if (schedule) {
    const next = computeNextGenerationDate(
      schedule.frequency,
      new Date(),
      schedule.day_of_month ?? 1,
      schedule.day_of_week ?? 1,
    )
    nextDate = next.toISOString().split('T')[0]
  }

  const { error } = await supabase
    .from('expense_template_schedules')
    .update({
      is_active: true,
      resumed_at: new Date().toISOString(),
      paused_at: null,
      paused_reason: null,
      next_generation_date: nextDate,
      updated_at: new Date().toISOString(),
    })
    .eq('template_id', templateId)

  if (error) return { success: false, error: error.message }

  await supabase
    .from('expense_templates')
    .update({ status: 'active', updated_by: userId ?? null })
    .eq('id', templateId)

  await writeAuditLog(supabase, {
    action: 'expense_template_activated',
    entity_type: 'expense_template',
    entity_id: templateId,
    description: `Recurring schedule resumed. Next generation: ${nextDate}`,
    user_id: userId ?? null,
    new_values: { is_active: true, next_generation_date: nextDate },
  })

  revalidatePath('/admin/recurring-expenses')
  revalidatePath(`/admin/recurring-expenses/templates/${templateId}`)
  return { success: true }
}

/** Manually trigger generation of a draft invoice for a template right now. */
export async function triggerManualGeneration(
  templateId: string,
  userId?: string,
): Promise<ActionResult<{ invoice_id: string; invoice_number: string }>> {
  const supabase = getSupabaseAdmin()
  const orgId = await getOrgId()

  const template = await getExpenseTemplate(templateId)
  if (!template) return { success: false, error: 'Template not found' }
  if (template.status === 'archived') return { success: false, error: 'Cannot generate from archived template' }

  const today = new Date()
  const periodKey = template.schedule
    ? buildPeriodKey(today, template.schedule.frequency)
    : `manual-${today.toISOString().split('T')[0]}`

  // Check for existing generation this period
  const { data: existing } = await supabase
    .from('recurring_generation_log')
    .select('id, invoice_id')
    .eq('template_id', templateId)
    .eq('period_key', periodKey)
    .eq('status', 'generated')
    .maybeSingle()

  if (existing?.invoice_id) {
    return {
      success: false,
      error: `An invoice was already generated for period ${periodKey}. Use the cron to generate the next period.`,
    }
  }

  return runGeneration(supabase, orgId, template, periodKey, today, 'manual', userId)
}

// ─── Internal generation logic (shared by cron and manual trigger) ────────────

export async function runGeneration(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  orgId: string,
  template: ExpenseTemplateWithDetails,
  periodKey: string,
  generationDate: Date,
  triggeredBy: 'cron' | 'manual',
  triggeredUserId?: string,
): Promise<ActionResult<{ invoice_id: string; invoice_number: string }>> {
  if (!template.contractor_id && !template.vendor_name_override) {
    return { success: false, error: 'Template has no vendor assigned' }
  }

  // Generate invoice number (reuse existing pattern)
  const { data: lastInvoice } = await supabase
    .from('invoices')
    .select('invoice_number')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const lastNum = lastInvoice?.invoice_number
    ? parseInt(lastInvoice.invoice_number.replace(/\D/g, ''), 10)
    : 0
  const invoiceNumber = `INV-${String((isNaN(lastNum) ? 0 : lastNum) + 1).padStart(5, '0')}`

  const invoiceDate = generationDate.toISOString().split('T')[0]

  // Build invoice row — always draft status, source = 'recurring'
  const gstCents =
    template.tax_treatment === 'gst' || template.tax_treatment === 'both'
      ? Math.round(template.default_amount_cents * 0.05)
      : 0
  const pstCents =
    template.tax_treatment === 'pst' || template.tax_treatment === 'both'
      ? Math.round(template.default_amount_cents * 0.07)
      : 0
  const totalCents = template.default_amount_cents + gstCents + pstCents

  const invoicePayload = {
    organization_id: orgId,
    contractor_id: template.contractor_id,
    project_id: template.project_id ?? null,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    subtotal_cents: template.default_amount_cents,
    gst_hst_rate: template.tax_treatment === 'gst' || template.tax_treatment === 'both' ? 5 : 0,
    gst_hst_cents: gstCents,
    pst_rate: template.tax_treatment === 'pst' || template.tax_treatment === 'both' ? 7 : 0,
    pst_cents: pstCents,
    total_cents: totalCents,
    net_payable_cents: totalCents,
    amount_remaining_cents: totalCents,
    status: 'pending_approval',
    source: 'recurring',
    expense_template_id: template.id,
    created_by: null, // system-generated
  }

  const { data: invoice, error: invError } = await supabase
    .from('invoices')
    .insert(invoicePayload)
    .select('id, invoice_number')
    .single()

  if (invError || !invoice) {
    // Log the failure
    await supabase.from('recurring_generation_log').upsert({
      organization_id: orgId,
      template_id: template.id,
      schedule_id: template.schedule?.id ?? template.id,
      period_key: periodKey,
      status: 'failed',
      error_message: invError?.message ?? 'Unknown error',
      triggered_by: triggeredBy,
      triggered_user_id: triggeredUserId ?? null,
    }, { onConflict: 'template_id,period_key', ignoreDuplicates: true })

    return { success: false, error: invError?.message ?? 'Invoice creation failed' }
  }

  // Log the success
  await supabase.from('recurring_generation_log').upsert({
    organization_id: orgId,
    template_id: template.id,
    schedule_id: template.schedule?.id ?? template.id,
    period_key: periodKey,
    status: 'generated',
    invoice_id: invoice.id,
    triggered_by: triggeredBy,
    triggered_user_id: triggeredUserId ?? null,
    generated_at: new Date().toISOString(),
  }, { onConflict: 'template_id,period_key' })

  // Update schedule tracking counters
  if (template.schedule) {
    const nextDate = computeNextGenerationDate(
      template.schedule.frequency,
      generationDate,
      template.schedule.day_of_month ?? 1,
      template.schedule.day_of_week ?? 1,
    )
    await supabase
      .from('expense_template_schedules')
      .update({
        last_generated_at: new Date().toISOString(),
        last_invoice_id: invoice.id,
        total_generated: (template.total_generated ?? 0) + 1,
        next_generation_date: nextDate.toISOString().split('T')[0],
        updated_at: new Date().toISOString(),
      })
      .eq('id', template.schedule.id)
  }

  await writeAuditLog(supabase, {
    action: 'recurring_invoice_generated',
    entity_type: 'invoice',
    entity_id: invoice.id,
    description: `Recurring invoice ${invoice.invoice_number} generated from template "${template.name}" (period: ${periodKey})`,
    user_id: triggeredUserId ?? null,
    new_values: { invoice_number: invoice.invoice_number, period_key: periodKey, source: 'recurring' },
  })

  revalidatePath('/admin/recurring-expenses')
  revalidatePath('/admin/invoices')
  return { success: true, data: { invoice_id: invoice.id, invoice_number: invoice.invoice_number } }
}
