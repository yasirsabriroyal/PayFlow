import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { buildPeriodKey } from '@/lib/recurring-expenses/schedule-utils'
import { runGeneration } from '@/lib/recurring-expenses/actions'
import type { ExpenseTemplateWithDetails, ExpenseTemplateSchedule } from '@/lib/recurring-expenses/types'

// Must run on Node runtime — uses service-role client
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Recurring Expense Engine — Daily Cron
 *
 * Schedule: 0 6 * * *  (6:00 AM UTC)
 *
 * For each active schedule whose next_generation_date <= today:
 *   1. Compute period_key (idempotency guard)
 *   2. Check recurring_generation_log for existing entry (skip if found)
 *   3. Create invoice in pending_approval status with source = 'recurring'
 *   4. Log result and advance next_generation_date
 *
 * Design properties:
 *   - Safe to retry: UNIQUE(template_id, period_key) prevents duplicates
 *   - Non-blocking: one template failure does not stop others
 *   - Fully audited: every attempt is logged in recurring_generation_log
 */
export async function GET(request: Request) {
  // Authorization: Vercel sends CRON_SECRET as Bearer token
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabase = getSupabaseAdmin()
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const todayStr = today.toISOString().split('T')[0]

  // Resolve org id
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('id')
    .eq('is_default', true)
    .limit(1)
    .single()

  if (!orgRow?.id) {
    return NextResponse.json({ error: 'No default organization found' }, { status: 500 })
  }

  const orgId: string = orgRow.id

  // Fetch all active schedules that are due today or overdue.
  // BUG-FIX (Issue 7): Removed a dead first query that used an unsupported
  // PostgREST `.is('expense_templates.status', null)` join filter. The result
  // was discarded and a second identical query (minus the broken filter) was
  // used instead. Removed the dead query to save one unnecessary round-trip.
  const { data: schedules } = await supabase
    .from('expense_template_schedules')
    .select(`
      id,
      template_id,
      frequency,
      day_of_month,
      day_of_week,
      start_date,
      end_date,
      next_generation_date,
      total_generated,
      organization_id
    `)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .lte('next_generation_date', todayStr)

  if (!schedules || schedules.length === 0) {
    return NextResponse.json({
      processed: 0,
      generated: 0,
      skipped: 0,
      failed: 0,
      message: 'No schedules due today',
    })
  }

  console.log(`[recurring-engine] ${schedules.length} schedule(s) due on ${todayStr}`)

  const results = {
    generated: 0,
    skipped: 0,
    failed: 0,
    details: [] as { template_id: string; status: string; invoice_number?: string; error?: string }[],
  }

  for (const schedule of schedules) {
    const templateId = schedule.template_id
    const periodKey = buildPeriodKey(today, schedule.frequency)

    // Check idempotency: already generated this period?
    const { data: existingLog } = await supabase
      .from('recurring_generation_log')
      .select('id, status')
      .eq('template_id', templateId)
      .eq('period_key', periodKey)
      .maybeSingle()

    if (existingLog) {
      console.log(`[recurring-engine] ${templateId} — already processed for period ${periodKey} (${existingLog.status}), skipping`)
      results.skipped++
      results.details.push({ template_id: templateId, status: 'skipped' })
      continue
    }

    // Check end_date
    if (schedule.end_date && schedule.end_date < todayStr) {
      await supabase
        .from('expense_template_schedules')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', schedule.id)

      await supabase.from('recurring_generation_log').insert({
        organization_id: orgId,
        template_id: templateId,
        schedule_id: schedule.id,
        period_key: periodKey,
        status: 'skipped',
        skip_reason: 'Schedule end_date reached',
        triggered_by: 'cron',
      })

      results.skipped++
      results.details.push({ template_id: templateId, status: 'skipped' })
      continue
    }

    // Fetch the full template with joins for generation
    const { data: templateRaw } = await supabase
      .from('expense_templates')
      .select(`
        *,
        contractors ( company_name, email, vendor_type ),
        contractor_categories ( name ),
        contractor_subcategories ( name ),
        projects ( name )
      `)
      .eq('id', templateId)
      .single()

    if (!templateRaw || templateRaw.status === 'archived') {
      results.skipped++
      results.details.push({ template_id: templateId, status: 'skipped' })
      continue
    }

    // Assemble enriched template object
    const template: ExpenseTemplateWithDetails = {
      ...(templateRaw as Omit<ExpenseTemplateWithDetails, 'vendor_name' | 'vendor_email' | 'vendor_type' | 'category_name' | 'subcategory_name' | 'project_name' | 'schedule' | 'generated_this_month' | 'total_generated' | 'last_invoice_number'>),
      vendor_name: (templateRaw.contractors as Record<string, string> | null)?.company_name ?? templateRaw.vendor_name_override ?? null,
      vendor_email: (templateRaw.contractors as Record<string, string> | null)?.email ?? null,
      vendor_type: ((templateRaw.contractors as Record<string, string> | null)?.vendor_type ?? null) as import('@/lib/recurring-expenses/types').VendorType | null,
      category_name: (templateRaw.contractor_categories as Record<string, string> | null)?.name ?? null,
      subcategory_name: (templateRaw.contractor_subcategories as Record<string, string> | null)?.name ?? null,
      project_name: (templateRaw.projects as Record<string, string> | null)?.name ?? null,
      schedule: schedule as ExpenseTemplateSchedule,
      generated_this_month: 0,
      total_generated: schedule.total_generated ?? 0,
      last_invoice_number: null,
    }

    try {
      const result = await runGeneration(supabase, orgId, template, periodKey, today, 'cron')

      if (result.success && result.data) {
        results.generated++
        results.details.push({
          template_id: templateId,
          status: 'generated',
          invoice_number: result.data.invoice_number,
        })
        console.log(`[recurring-engine] ${templateId} — generated ${result.data.invoice_number}`)
      } else {
        results.failed++
        results.details.push({ template_id: templateId, status: 'failed', error: result.error })
        console.error(`[recurring-engine] ${templateId} — failed:`, result.error)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      results.failed++
      results.details.push({ template_id: templateId, status: 'failed', error: message })
      console.error(`[recurring-engine] ${templateId} — exception:`, message)

      // Log the failure so it is visible in the dashboard
      await supabase.from('recurring_generation_log').upsert({
        organization_id: orgId,
        template_id: templateId,
        schedule_id: schedule.id,
        period_key: periodKey,
        status: 'failed',
        error_message: message,
        triggered_by: 'cron',
      }, { onConflict: 'template_id,period_key', ignoreDuplicates: true })
    }
  }

  console.log(
    `[recurring-engine] Done — generated: ${results.generated}, skipped: ${results.skipped}, failed: ${results.failed}`,
  )

  return NextResponse.json({
    processed: schedules.length,
    generated: results.generated,
    skipped: results.skipped,
    failed: results.failed,
    date: todayStr,
    details: results.details,
  })
}
