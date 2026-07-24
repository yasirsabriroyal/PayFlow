'use server'

/**
 * PM Actions - Server Actions for Project Manager
 * 
 * IMPORTANT: contractor_status enum valid values are:
 * - active
 * - inactive  
 * - pending_kyc (NOT "pending")
 * - suspended
 */

import { withPermission } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permissions/constants'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { PAID_PAYMENT_STATUSES } from '@/lib/payments/status'
import { resolveInternalUserId } from '@/lib/utils/resolve-user'
import { applyInvoiceStatusChange } from '@/lib/invoices/status-flow'
import { resolvePmScope } from '@/lib/permissions/pm-scope'
import { withInvoiceProjectPermission } from '@/lib/permissions/project-roles'

/**
 * Build a status-engine actor from the authenticated user. Resolves the
 * internal users.id and a display name for audit/history/notifications.
 */
async function buildActor(user: { id: string; email?: string; role: string }) {
  const supabase = getSupabaseAdmin()
  const { data: u } = await supabase
    .from('users')
    .select('id, first_name, last_name')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  return {
    userId: u?.id ?? null,
    name: `${u?.first_name ?? ''} ${u?.last_name ?? ''}`.trim() || user.email || 'User',
    role: user.role,
    authUserId: user.id,
  }
}

/**
 * Approve an invoice (PM). Routes through the centralized status engine so the
 * transition is validated and audit + history + notifications are emitted.
 */
export async function pmApproveInvoice(invoiceId: string) {
  return withInvoiceProjectPermission(invoiceId, PERMISSIONS.INVOICES.APPROVE_INVOICES, async (user) => {
    const actor = await buildActor(user)
    const { invoice } = await applyInvoiceStatusChange({
      invoiceId,
      newStatus: 'approved',
      actor,
    })
    return { success: true as const, invoice }
  })
}

/**
 * Reject an invoice (PM) with a required reason.
 */
export async function pmRejectInvoice(invoiceId: string, reason: string) {
  return withInvoiceProjectPermission(invoiceId, PERMISSIONS.INVOICES.REJECT_INVOICES, async (user) => {
    if (!reason?.trim()) {
      return { success: false as const, error: 'A rejection reason is required' }
    }
    const actor = await buildActor(user)
    const { invoice } = await applyInvoiceStatusChange({
      invoiceId,
      newStatus: 'rejected',
      actor,
      reason,
      extraInvoiceUpdates: {
        rejection_reason: reason,
        rejected_by_user_id: actor.userId,
        rejected_at: new Date().toISOString(),
      },
    })
    return { success: true as const, invoice }
  })
}

/**
 * Flag an invoice as disputed (PM) with a required reason.
 */
export async function pmDisputeInvoice(invoiceId: string, reason: string) {
  return withInvoiceProjectPermission(invoiceId, PERMISSIONS.INVOICES.DISPUTE_INVOICES, async (user) => {
    if (!reason?.trim()) {
      return { success: false as const, error: 'A dispute reason is required' }
    }
    const actor = await buildActor(user)
    const { invoice } = await applyInvoiceStatusChange({
      invoiceId,
      newStatus: 'disputed',
      actor,
      reason,
      extraInvoiceUpdates: {
        dispute_reason: reason,
        disputed_by_user_id: actor.userId,
        disputed_at: new Date().toISOString(),
      },
    })
    return { success: true as const, invoice }
  })
}

/**
 * Fetch payment certificates for a specific invoice.
 * Uses admin client to bypass RLS — consistent with all other server actions.
 */
export async function getCertificatesForInvoice(invoiceId: string) {
  return withPermission(PERMISSIONS.INVOICES.VIEW_AP_QUEUE, async () => {
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from('payment_certificates')
      .select(`
        id,
        certificate_number,
        certified_amount_cents,
        net_payable_cents,
        status,
        created_at,
        submitted_at,
        approved_at,
        rejection_reason,
        work_period_start,
        work_period_end,
        payments(id)
      `)
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('getCertificatesForInvoice error:', error)
      return { success: false, error: error.message, certificates: [] }
    }

    return { success: true, certificates: data || [] }
  })
}

export async function getPMProjects() {
  return withPermission(PERMISSIONS.PROJECTS.VIEW_PROJECTS, async (user) => {
    const supabase = getSupabaseAdmin()

    // Restrict project managers to their assigned projects.
    const scope = await resolvePmScope(user)
    if (scope.scoped && scope.projectIds.length === 0) {
      return { success: true, projects: [] }
    }

    let query = supabase
      .from('projects')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (scope.scoped) {
      query = query.in('id', scope.projectIds)
    }

    const { data: projects, error } = await query

    if (error) {
      console.error('Get PM projects error:', error)
      return { success: false, projects: [] }
    }

    return { success: true, projects: projects || [] }
  })
}

// Fetches contractors for PM views
export async function getPMContractors() {
  return withPermission(PERMISSIONS.VENDORS.VIEW_VENDORS, async (user) => {
    const supabase = getSupabaseAdmin()

    // Project managers only see contractors linked to their assigned projects
    // (via project_contractors). Other roles see all active contractors.
    const scope = await resolvePmScope(user)
    let contractorIds: string[] | null = null
    if (scope.scoped) {
      if (scope.projectIds.length === 0) {
        return { success: true, contractors: [] }
      }
      const { data: links, error: linksError } = await supabase
        .from('project_contractors')
        .select('contractor_id')
        .in('project_id', scope.projectIds)

      if (linksError) {
        console.error('Get PM contractor links error:', linksError)
        return { success: false, contractors: [] }
      }
      contractorIds = Array.from(
        new Set((links || []).map((l) => l.contractor_id).filter((id): id is string => Boolean(id)))
      )
      if (contractorIds.length === 0) {
        return { success: true, contractors: [] }
      }
    }

    // CRITICAL: Use only valid contractor_status enum values
    // Valid: active, inactive, pending_kyc, suspended
    // INVALID: "pending" (does not exist in enum)
    let query = supabase
      .from('contractors')
      .select('id, company_name, contact_name, status')
      .in('status', ['active', 'pending_kyc'])

    if (contractorIds) {
      query = query.in('id', contractorIds)
    }

    const { data: contractors, error } = await query

    if (error) {
      console.error('Get contractors error:', error)
      return { success: false, contractors: [] }
    }

    return { success: true, contractors: contractors || [] }
  })
}

export async function getPMInvoices() {
  return withPermission(PERMISSIONS.INVOICES.VIEW_AP_QUEUE, async (user) => {
    const supabase = getSupabaseAdmin()

    // Restrict project managers to invoices on their assigned projects.
    const scope = await resolvePmScope(user)
    if (scope.scoped && scope.projectIds.length === 0) {
      return { success: true, invoices: [] }
    }

    let query = supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        project_id,
        total_cents,
        status,
        invoice_date,
        created_at,
        contractor:contractors(company_name),
        project:projects(id, name, project_number)
      `)
      .order('created_at', { ascending: false })

    if (scope.scoped) {
      query = query.in('project_id', scope.projectIds)
    }

    const { data: invoices, error } = await query

    if (error) {
      console.error('Get PM invoices error:', error)
      return { success: false, invoices: [] }
    }

    return { success: true, invoices: invoices || [] }
  })
}

// Async wrapper alias for backwards compatibility ('use server' files cannot export non-async values)
export async function getContractors(...args: Parameters<typeof getPMContractors>) {
  return getPMContractors(...args)
}

// Type for payment certificate input
// Holdback is applied at the INVOICE level only — certificates cover the full
// certified amount with no per-cert holdback deduction.
export type CreatePaymentCertificateInput = {
  invoice_id: string
  project_id: string
  contractor_id: string
  certified_amount_cents: number
  description?: string
  work_period_start?: string
  work_period_end?: string
}

/**
 * Create a payment certificate as a draft.
 *
 * Business rules:
 * - Holdback is reserved at the invoice level; certificates are issued for the
 *   full certified amount with no holdback deduction (holdback_amount_cents = 0).
 * - Available balance = invoice_total - invoice_holdback - sum_of_all_existing_certs
 * - New cert amount must be <= available balance.
 */
export async function createPaymentCertificate(input: CreatePaymentCertificateInput) {
  return withPermission(PERMISSIONS.INVOICES.APPROVE_INVOICES, async (userData) => {
    const supabase = getSupabaseAdmin()

    // 1. Fetch invoice to snapshot totals and validate it exists
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, invoice_number, total_cents, holdback_cents')
      .eq('id', input.invoice_id)
      .single()

    if (invoiceError || !invoice) {
      return { success: false, error: 'Invoice not found' }
    }

    // 2. Fetch all existing certificates to compute running totals
    const { data: existingCerts, error: certsError } = await supabase
      .from('payment_certificates')
      .select('certified_amount_cents')
      .eq('invoice_id', input.invoice_id)

    if (certsError) {
      console.error('Fetch existing certificates error:', certsError)
      return { success: false, error: 'Failed to check existing certificates' }
    }

    const existingCount = (existingCerts || []).length
    const previousCertifiedCents = (existingCerts || []).reduce(
      (sum, c) => sum + (c.certified_amount_cents || 0),
      0
    )

    // 3. Available = invoice_total - holdback_reserved - previously_certified
    const holdbackCents = invoice.holdback_cents || 0
    const availableCents = invoice.total_cents - holdbackCents - previousCertifiedCents

    // 4. Validate
    if (input.certified_amount_cents <= 0) {
      return { success: false, error: 'Certificate amount must be greater than 0' }
    }

    if (availableCents <= 0) {
      return {
        success: false,
        error: 'Cannot issue certificate: remaining balance does not exceed the holdback amount',
      }
    }

    if (input.certified_amount_cents > availableCents) {
      return {
        success: false,
        error: `Certificate amount exceeds available balance. Available: $${(availableCents / 100).toFixed(2)}`,
      }
    }

    // 5. Generate certificate number (e.g. INV-ABC123-PC01, INV-ABC123-PC02, ...)
    const certificateNumber = `${invoice.invoice_number}-PC${String(existingCount + 1).padStart(2, '0')}`

    // 6. Holdback is at invoice level only — no per-cert holdback deduction
    const remainingAfterThisCents = availableCents - input.certified_amount_cents

    // 7. Insert into payment_certificates as draft
    const { data: certificate, error: insertError } = await supabase
      .from('payment_certificates')
      .insert({
        certificate_number: certificateNumber,
        invoice_id: input.invoice_id,
        contractor_id: input.contractor_id,
        project_id: input.project_id,
        certified_amount_cents: input.certified_amount_cents,
        holdback_amount_cents: 0,
        net_payable_cents: input.certified_amount_cents,
        invoice_total_cents: invoice.total_cents,
        previous_certified_cents: previousCertifiedCents,
        remaining_after_this_cents: remainingAfterThisCents,
        status: 'draft',
        description: input.description || null,
        work_period_start: input.work_period_start || null,
        work_period_end: input.work_period_end || null,
        created_by: userData.id,
      })
      .select()
      .single()

    if (insertError) {
      console.error('Create payment certificate error:', insertError)
      return { success: false, error: insertError.message }
    }

    // 8. Audit log
    await supabase.from('audit_logs').insert({
      action: 'certificate_created',
      entity_type: 'payment_certificate',
      entity_id: certificate.id,
      user_id: userData.id,
      description: `Created payment certificate ${certificateNumber} for $${(input.certified_amount_cents / 100).toFixed(2)}`,
      new_values: {
        certificate_number: certificateNumber,
        certified_amount_cents: input.certified_amount_cents,
        invoice_id: input.invoice_id,
        status: 'draft',
      },
    })

    return { success: true, certificate }
  })
}

/**
 * Update a draft payment certificate (amount, description, work period).
 * Only draft certificates can be edited.
 * Business rule: same balance validation as create (excluding this cert from the sum).
 */
export async function updatePaymentCertificate(input: {
  certificate_id: string
  certified_amount_cents: number
  description?: string
  work_period_start?: string
  work_period_end?: string
}) {
  return withPermission(PERMISSIONS.INVOICES.APPROVE_INVOICES, async (userData) => {
    const supabase = getSupabaseAdmin()

    // 1. Fetch the cert being edited
    const { data: cert, error: certError } = await supabase
      .from('payment_certificates')
      .select('id, certificate_number, status, invoice_id, contractor_id, project_id')
      .eq('id', input.certificate_id)
      .single()

    if (certError || !cert) {
      return { success: false, error: 'Certificate not found' }
    }

    if (cert.status !== 'draft') {
      return {
        success: false,
        error: `Cannot edit certificate with status '${cert.status}'. Only draft certificates can be edited.`,
      }
    }

    if (input.certified_amount_cents <= 0) {
      return { success: false, error: 'Certificate amount must be greater than 0' }
    }

    // 2. Fetch invoice totals
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, total_cents, holdback_cents')
      .eq('id', cert.invoice_id)
      .single()

    if (invoiceError || !invoice) {
      return { success: false, error: 'Invoice not found' }
    }

    // 3. Sum all OTHER certs on this invoice (excluding the one being edited)
    const { data: otherCerts, error: certsError } = await supabase
      .from('payment_certificates')
      .select('certified_amount_cents')
      .eq('invoice_id', cert.invoice_id)
      .neq('id', input.certificate_id)

    if (certsError) {
      return { success: false, error: 'Failed to check existing certificates' }
    }

    const otherCertifiedCents = (otherCerts || []).reduce(
      (sum, c) => sum + (c.certified_amount_cents || 0),
      0
    )

    const holdbackCents = invoice.holdback_cents || 0
    const availableCents = invoice.total_cents - holdbackCents - otherCertifiedCents

    if (input.certified_amount_cents > availableCents) {
      return {
        success: false,
        error: `Certificate amount exceeds available balance. Available: $${(availableCents / 100).toFixed(2)}`,
      }
    }

    // 4. Update the certificate
    const remainingAfterThisCents = availableCents - input.certified_amount_cents

    const { data: updated, error: updateError } = await supabase
      .from('payment_certificates')
      .update({
        certified_amount_cents: input.certified_amount_cents,
        holdback_amount_cents: 0,
        net_payable_cents: input.certified_amount_cents,
        remaining_after_this_cents: remainingAfterThisCents,
        description: input.description ?? null,
        work_period_start: input.work_period_start ?? null,
        work_period_end: input.work_period_end ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.certificate_id)
      .select()
      .single()

    if (updateError) {
      console.error('Update certificate error:', updateError)
      return { success: false, error: updateError.message }
    }

    // 5. Audit log
    await supabase.from('audit_logs').insert({
      action: 'certificate_updated',
      entity_type: 'payment_certificate',
      entity_id: input.certificate_id,
      user_id: userData.id,
      description: `Updated draft certificate ${cert.certificate_number} to $${(input.certified_amount_cents / 100).toFixed(2)}`,
      new_values: {
        certified_amount_cents: input.certified_amount_cents,
        description: input.description,
        work_period_start: input.work_period_start,
        work_period_end: input.work_period_end,
      },
    })

    return { success: true, certificate: updated }
  })
}

/**
 * Submit a draft (or rejected) certificate for accountant approval.
 * Moves status: draft → pending  OR  rejected → pending.
 */
export async function submitCertificate(input: { certificate_id: string }) {
  return withPermission(PERMISSIONS.INVOICES.APPROVE_INVOICES, async (userData) => {
    const supabase = getSupabaseAdmin()

    const { data: cert, error: fetchError } = await supabase
      .from('payment_certificates')
      .select('id, status, certificate_number')
      .eq('id', input.certificate_id)
      .single()

    if (fetchError || !cert) {
      return { success: false, error: 'Certificate not found' }
    }

    if (!['draft', 'rejected'].includes(cert.status)) {
      return {
        success: false,
        error: `Cannot submit certificate with status '${cert.status}'. Only draft or rejected certificates can be submitted.`,
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from('payment_certificates')
      .update({
        status: 'pending',
        submitted_at: new Date().toISOString(),
      })
      .eq('id', input.certificate_id)
      .select()
      .single()

    if (updateError) {
      console.error('Submit certificate error:', updateError)
      return { success: false, error: updateError.message }
    }

    await supabase.from('audit_logs').insert({
      action: 'certificate_submitted',
      entity_type: 'payment_certificate',
      entity_id: input.certificate_id,
      user_id: userData.id,
      description: `Submitted certificate ${cert.certificate_number} for approval`,
      old_values: { status: cert.status },
      new_values: { status: 'pending' },
    })

    return { success: true, certificate: updated }
  })
}

/**
 * Reset a rejected certificate back to draft so the PM can revise and
 * re-submit it. Moves status: rejected → draft.
 * The PM then edits the certificate and calls submitCertificate() again.
 */
export async function resubmitCertificate(input: { certificate_id: string }) {
  return withPermission(PERMISSIONS.INVOICES.APPROVE_INVOICES, async (userData) => {
    const supabase = getSupabaseAdmin()

    const { data: cert, error: fetchError } = await supabase
      .from('payment_certificates')
      .select('id, status, certificate_number')
      .eq('id', input.certificate_id)
      .single()

    if (fetchError || !cert) {
      return { success: false, error: 'Certificate not found' }
    }

    if (cert.status !== 'rejected') {
      return {
        success: false,
        error: `Cannot resubmit certificate with status '${cert.status}'. Only rejected certificates can be resubmitted.`,
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from('payment_certificates')
      .update({ status: 'draft' })
      .eq('id', input.certificate_id)
      .select()
      .single()

    if (updateError) {
      console.error('Resubmit certificate error:', updateError)
      return { success: false, error: updateError.message }
    }

    await supabase.from('audit_logs').insert({
      action: 'certificate_reset_to_draft',
      entity_type: 'payment_certificate',
      entity_id: input.certificate_id,
      user_id: userData.id,
      description: `Reset certificate ${cert.certificate_number} to draft for revision`,
      old_values: { status: 'rejected' },
      new_values: { status: 'draft' },
    })

    return { success: true, certificate: updated }
  })
}

/**
 * Approve a pending payment certificate.
 * Permission: admin or project_manager.
 * Moves status: pending → approved.
 * Sets approved_by and approved_at.
 */
export async function approvePaymentCertificate(input: { certificate_id: string }) {
  return withPermission(PERMISSIONS.INVOICES.APPROVE_INVOICES, async (userData) => {
    if (!['admin', 'project_manager'].includes(userData.role)) {
      return { success: false, error: 'Permission denied: admin or project manager role required' }
    }

    const supabase = getSupabaseAdmin()

    const { data: cert, error: fetchError } = await supabase
      .from('payment_certificates')
      .select('id, status, certificate_number')
      .eq('id', input.certificate_id)
      .single()

    if (fetchError || !cert) {
      return { success: false, error: 'Certificate not found' }
    }

    if (cert.status !== 'pending') {
      return {
        success: false,
        error: `Cannot approve certificate with status '${cert.status}'. Only pending certificates can be approved.`,
      }
    }

    // Resolve internal users.id from auth UUID (approved_by FK references users(id))
    const internalUserId = await resolveInternalUserId(userData.id, supabase)
    if (!internalUserId) {
      console.error('approvePaymentCertificate: could not resolve internal user ID')
      return { success: false, error: 'Could not resolve internal user ID' }
    }

    const now = new Date().toISOString()

    const { data: updated, error: updateError } = await supabase
      .from('payment_certificates')
      .update({
        status: 'approved',
        approved_by: internalUserId,
        approved_at: now,
      })
      .eq('id', input.certificate_id)
      .select()
      .single()

    if (updateError) {
      console.error('Approve certificate error:', updateError)
      return { success: false, error: updateError.message }
    }

    await supabase.from('audit_logs').insert({
      action: 'certificate_approved',
      entity_type: 'payment_certificate',
      entity_id: input.certificate_id,
      user_id: userData.id,
      description: `Approved certificate ${cert.certificate_number}`,
      old_values: { status: 'pending' },
      new_values: { status: 'approved', approved_by: internalUserId, approved_at: now },
    })

    return { success: true, certificate: updated }
  })
}

/**
 * Reject a pending payment certificate with a mandatory reason.
 * Permission: admin or project_manager.
 * Moves status: pending → rejected.
 * Sets rejection_reason, rejected_by, and rejected_at.
 * PM can then call resubmitCertificate() to reset to draft for revision.
 */
export async function rejectPaymentCertificate(input: {
  certificate_id: string
  reason: string
}) {
  return withPermission(PERMISSIONS.INVOICES.APPROVE_INVOICES, async (userData) => {
    if (!['admin', 'project_manager'].includes(userData.role)) {
      return { success: false, error: 'Permission denied: admin or project manager role required' }
    }

    if (!input.reason?.trim()) {
      return { success: false, error: 'Rejection reason is required' }
    }

    const supabase = getSupabaseAdmin()

    const { data: cert, error: fetchError } = await supabase
      .from('payment_certificates')
      .select('id, status, certificate_number')
      .eq('id', input.certificate_id)
      .single()

    if (fetchError || !cert) {
      return { success: false, error: 'Certificate not found' }
    }

    if (cert.status !== 'pending') {
      return {
        success: false,
        error: `Cannot reject certificate with status '${cert.status}'. Only pending certificates can be rejected.`,
      }
    }

    // Resolve internal users.id from auth UUID (rejected_by FK references users(id))
    const internalUserId = await resolveInternalUserId(userData.id, supabase)
    if (!internalUserId) {
      console.error('rejectPaymentCertificate: could not resolve internal user ID')
      return { success: false, error: 'Could not resolve internal user ID' }
    }

    const now = new Date().toISOString()

    const { data: updated, error: updateError } = await supabase
      .from('payment_certificates')
      .update({
        status: 'rejected',
        rejection_reason: input.reason,
        rejected_by: internalUserId,
        rejected_at: now,
      })
      .eq('id', input.certificate_id)
      .select()
      .single()

    if (updateError) {
      console.error('Reject certificate error:', updateError)
      return { success: false, error: updateError.message }
    }

    await supabase.from('audit_logs').insert({
      action: 'certificate_rejected',
      entity_type: 'payment_certificate',
      entity_id: input.certificate_id,
      user_id: userData.id,
      description: `Rejected certificate ${cert.certificate_number}: ${input.reason}`,
      old_values: { status: 'pending' },
      new_values: {
        status: 'rejected',
        rejection_reason: input.reason,
        rejected_by: internalUserId,
        rejected_at: now,
      },
    })

    return { success: true, certificate: updated }
  })
}

// Get pending approvals (invoices and payment requests awaiting PM approval)
export async function getPendingApprovals() {
  return withPermission(PERMISSIONS.INVOICES.VIEW_AP_QUEUE, async (user) => {
    const supabase = getSupabaseAdmin()

    // Restrict project managers to their assigned projects.
    const scope = await resolvePmScope(user)
    if (scope.scoped && scope.projectIds.length === 0) {
      return { success: true, approvals: [] }
    }

    // Fetch invoices with submitted or pending_approval status
    let invoicesQuery = supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        invoice_date,
        due_date,
        total_cents,
        holdback_cents,
        net_payable_cents,
        status,
        source,
        created_at,
        contractor:contractors(id, company_name),
        project:projects(id, name, project_number, current_budget_cents)
      `)
      .in('status', ['submitted', 'pending_approval'])
      .order('created_at', { ascending: false })

    if (scope.scoped) {
      invoicesQuery = invoicesQuery.in('project_id', scope.projectIds)
    }

    const { data: invoices, error: invoicesError } = await invoicesQuery

    if (invoicesError) {
      console.error('Get pending invoices error:', invoicesError)
      return { success: false, approvals: [], error: invoicesError.message }
    }

    // Transform invoices into approval format
    const approvals = (invoices || []).map((invoice) => {
      const contractor = invoice.contractor as unknown as { id: string; company_name: string } | null
      const project = invoice.project as unknown as { id: string; name: string; project_number: string; current_budget_cents: number } | null
      
      return {
        id: invoice.id,
        type: 'invoice' as const,
        projectId: project?.id || '',
        projectName: project?.name || 'Unknown Project',
        projectNumber: project?.project_number || '',
        projectBudget: (project?.current_budget_cents || 0) / 100,
        contractor: contractor?.company_name || 'Unknown Contractor',
        contractorId: contractor?.id || '',
        invoiceNumber: invoice.invoice_number,
        amount: invoice.total_cents / 100,
        holdback: (invoice.holdback_cents || 0) / 100,
        netPayable: (invoice.net_payable_cents || invoice.total_cents) / 100,
        description: invoice.source === 'manual' ? 'Payment Certificate' : 'Contractor Invoice',
        submittedDate: invoice.created_at,
        dueDate: invoice.due_date,
        status: invoice.status,
      }
    })

    return { success: true, approvals }
  })
}

// Get approved/paid invoices for PM to view their history
export async function getPMApprovedInvoices() {
  return withPermission(PERMISSIONS.INVOICES.VIEW_AP_QUEUE, async (user) => {
    const supabase = getSupabaseAdmin()

    // Restrict project managers to their assigned projects.
    const scope = await resolvePmScope(user)
    if (scope.scoped && scope.projectIds.length === 0) {
      return { success: true, invoices: [] }
    }

    // Fetch invoices with approved or paid status
    let invoicesQuery = supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        invoice_date,
        due_date,
        total_cents,
        holdback_cents,
        net_payable_cents,
        amount_paid_cents,
        status,
        source,
        created_at,
        updated_at,
        contractor:contractors(id, company_name),
        project:projects(id, name, project_number, current_budget_cents)
      `)
      .in('status', ['approved', 'paid'])
      .order('updated_at', { ascending: false })

    if (scope.scoped) {
      invoicesQuery = invoicesQuery.in('project_id', scope.projectIds)
    }

    const { data: invoices, error: invoicesError } = await invoicesQuery

    if (invoicesError) {
      console.error('Get approved invoices error:', invoicesError)
      return { success: false, invoices: [], error: invoicesError.message }
    }

    // Transform invoices into a display format
    const transformedInvoices = (invoices || []).map((invoice) => {
      const contractor = invoice.contractor as unknown as { id: string; company_name: string } | null
      const project = invoice.project as unknown as { id: string; name: string; project_number: string; current_budget_cents: number } | null
      
      return {
        id: invoice.id,
        type: 'invoice' as const,
        projectId: project?.id || '',
        projectName: project?.name || 'Unknown Project',
        projectNumber: project?.project_number || '',
        projectBudget: (project?.current_budget_cents || 0) / 100,
        contractor: contractor?.company_name || 'Unknown Contractor',
        contractorId: contractor?.id || '',
        invoiceNumber: invoice.invoice_number,
        amount: invoice.total_cents / 100,
        holdback: (invoice.holdback_cents || 0) / 100,
        netPayable: (invoice.net_payable_cents || invoice.total_cents) / 100,
        amountPaid: (invoice.amount_paid_cents || 0) / 100,
        description: invoice.source === 'manual' ? 'Payment Certificate' : 'Contractor Invoice',
        submittedDate: invoice.created_at,
        approvedDate: invoice.updated_at,
        dueDate: invoice.due_date,
        status: invoice.status,
      }
    })

    return { success: true, invoices: transformedInvoices }
  })
}

// Approve an invoice
export async function approveInvoice(invoiceId: string) {
  return withPermission(PERMISSIONS.INVOICES.APPROVE_INVOICES, async (userData) => {
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from('invoices')
      .update({
        status: 'approved',
        updated_at: new Date().toISOString()
      })
      .eq('id', invoiceId)
      .select()
      .single()

    if (error) {
      console.error('Approve invoice error:', error)
      return { success: false, error: error.message }
    }

    const auditUserId = await resolveInternalUserId(userData.id, supabase)
    if (auditUserId) {
      await supabase.from('audit_logs').insert({
        action: 'invoice_approved',
        entity_type: 'invoice',
        entity_id: invoiceId,
        user_id: auditUserId,
        description: `Approved invoice`,
        new_values: { status: 'approved' },
      })
    }

    return { success: true, invoice: data }
  })
}

// Reject an invoice
export async function rejectInvoice(invoiceId: string, reason: string) {
  return withPermission(PERMISSIONS.INVOICES.APPROVE_INVOICES, async (userData) => {
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from('invoices')
      .update({
        status: 'rejected',
        rejection_reason: reason,
        updated_at: new Date().toISOString()
      })
      .eq('id', invoiceId)
      .select()
      .single()

    if (error) {
      console.error('Reject invoice error:', error)
      return { success: false, error: error.message }
    }

    const auditUserId = await resolveInternalUserId(userData.id, supabase)
    if (auditUserId) {
      await supabase.from('audit_logs').insert({
        action: 'invoice_rejected',
        entity_type: 'invoice',
        entity_id: invoiceId,
        user_id: auditUserId,
        description: `Rejected invoice: ${reason}`,
        new_values: { status: 'rejected', rejection_reason: reason },
      })
    }

    return { success: true, invoice: data }
  })
}

// Create a new invoice (PM manual entry)
export async function createPMInvoice(input: {
  project_id: string
  contractor_id: string
  total_cents: number
  holdback_percentage: number
  description?: string
  notes?: string
}) {
  return withPermission(PERMISSIONS.INVOICES.CREATE_INVOICE, async (userData) => {
    const supabase = getSupabaseAdmin()
    
    // Validation
    if (!input.project_id) {
      return { success: false, error: 'Project is required' }
    }
    if (!input.contractor_id) {
      return { success: false, error: 'Contractor is required' }
    }
    if (input.total_cents <= 0) {
      return { success: false, error: 'Invoice total must be greater than 0' }
    }
    
    // Calculate holdback and net payable
    const holdbackRate = (input.holdback_percentage || 0) / 100
    const holdbackCents = Math.round(input.total_cents * holdbackRate)
    const netPayableCents = input.total_cents - holdbackCents
    
    // Generate invoice number
    const timestamp = Date.now().toString(36).toUpperCase()
    const random = Math.random().toString(36).substring(2, 6).toUpperCase()
    const invoiceNumber = `INV-${timestamp}-${random}`
    
    // Create the invoice
    const { data, error } = await supabase
      .from('invoices')
      .insert({
        invoice_number: invoiceNumber,
        project_id: input.project_id,
        contractor_id: input.contractor_id,
        subtotal_cents: input.total_cents,
        total_cents: input.total_cents,
        holdback_cents: holdbackCents,
        holdback_percent: input.holdback_percentage || 0,
        net_payable_cents: netPayableCents,
        source: 'manual',
        status: 'submitted',
        invoice_date: new Date().toISOString().split('T')[0],
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days from now
        total_certified_cents: 0,
        total_paid_cents: 0,
        amount_remaining_cents: netPayableCents,
        amount_paid_cents: 0,
        description: input.description || null,
        notes: input.notes || null,
      })
      .select()
      .single()
    
    if (error) {
      console.error('Create invoice error:', error)
      return { success: false, error: error.message }
    }
    
    // Log the action
    await supabase.from('audit_logs').insert({
      action: 'invoice_created',
      entity_type: 'invoice',
      entity_id: data.id,
      user_id: userData.id,
      description: `Created invoice ${invoiceNumber} for $${(input.total_cents / 100).toFixed(2)}`,
      new_values: {
        invoice_number: invoiceNumber,
        total_cents: input.total_cents,
        holdback_cents: holdbackCents,
        net_payable_cents: netPayableCents,
      },
    })
    
    return { success: true, invoice: data }
  })
}

/**
 * Get detailed contractor profile for PM view
 * Includes financial summary, projects, invoices, and payments
 */
export async function getPMContractorById(contractorId: string) {
  return withPermission(PERMISSIONS.VENDORS.VIEW_VENDORS, async (user) => {
    const supabase = getSupabaseAdmin()

    // Project managers may only open contractors linked to one of their
    // assigned projects (via project_contractors). Admin/accountant unscoped.
    const scope = await resolvePmScope(user)
    if (scope.scoped) {
      if (scope.projectIds.length === 0) {
        return { success: false, error: 'Contractor not found' }
      }
      const { data: link } = await supabase
        .from('project_contractors')
        .select('contractor_id')
        .eq('contractor_id', contractorId)
        .in('project_id', scope.projectIds)
        .limit(1)
        .maybeSingle()
      if (!link) {
        return { success: false, error: 'Contractor not found' }
      }
    }

    // Fetch contractor details
    const { data: contractor, error: contractorError } = await supabase
      .from('contractors')
      .select(`
        id,
        company_name,
        contact_name,
        email,
        phone,
        status,
        address_line1,
        address_line2,
        city,
        province,
        postal_code,
        business_number,
        is_corporation,
        wcb_clearance_expiry,
        notes,
        vendor_type,
        preferred_payment_method,
        etransfer_email,
        created_at
      `)
      .eq('id', contractorId)
      .single()
    
    if (contractorError || !contractor) {
      console.error('Get contractor error:', contractorError)
      return { success: false, error: 'Contractor not found' }
    }
    
    // Fetch invoices for this contractor (scoped to assigned projects for PMs)
    let invoicesQuery = supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        total_cents,
        holdback_cents,
        net_payable_cents,
        total_certified_cents,
        total_paid_cents,
        status,
        invoice_date,
        created_at,
        project:projects(id, name, project_number)
      `)
      .eq('contractor_id', contractorId)
      .order('created_at', { ascending: false })

    if (scope.scoped) {
      invoicesQuery = invoicesQuery.in('project_id', scope.projectIds)
    }

    const { data: invoices, error: invoicesError } = await invoicesQuery

    if (invoicesError) {
      console.error('Get contractor invoices error:', invoicesError)
    }
    
    // Fetch projects this contractor is associated with (via invoices)
    const projectIds = [...new Set((invoices || []).map(inv => (inv.project as unknown as { id: string } | null)?.id).filter(Boolean))]
    
    const { data: projects, error: projectsError } = await supabase
      .from('projects')
      .select(`
        id,
        name,
        project_number,
        is_active,
        start_date,
        estimated_completion_date,
        current_budget_cents,
        spent_cents
      `)
      .in('id', projectIds.length > 0 ? projectIds : ['00000000-0000-0000-0000-000000000000'])
      .order('created_at', { ascending: false })
    
    if (projectsError) {
      console.error('Get contractor projects error:', projectsError)
    }
    
    // Fetch payments to this contractor. For scoped PMs, restrict to payments
    // tied to payment certificates on their assigned projects.
    let payments:
      | {
          id: string
          amount_cents: number
          payment_method: string
          payment_date: string | null
          status: string
          created_at: string
        }[]
      | null = []

    if (scope.scoped) {
      // Collect all certificate ids for this contractor on assigned projects.
      const { data: scopedCerts } = await supabase
        .from('payment_certificates')
        .select('id')
        .eq('contractor_id', contractorId)
        .in('project_id', scope.projectIds)
      const scopedCertIds = (scopedCerts || []).map((c) => c.id)

      // Collect all payment request ids for this contractor on assigned projects.
      const { data: scopedReqs } = await supabase
        .from('payment_requests')
        .select('id')
        .eq('contractor_id', contractorId)
        .in('project_id', scope.projectIds)
      const scopedReqIds = (scopedReqs || []).map((r) => r.id)

      if (scopedCertIds.length > 0 || scopedReqIds.length > 0) {
        let query = supabase
          .from('payments')
          .select(`id, amount_cents, payment_method, payment_date, status, created_at`)
          .eq('contractor_id', contractorId)

        const conditions: string[] = []
        if (scopedCertIds.length > 0) {
          conditions.push(`payment_certificate_id.in.(${scopedCertIds.join(',')})`)
        }
        if (scopedReqIds.length > 0) {
          conditions.push(`payment_request_id.in.(${scopedReqIds.join(',')})`)
        }
        query = query.or(conditions.join(','))

        const { data: scopedPayments, error: paymentsError } = await query
          .order('created_at', { ascending: false })
          .limit(20)

        if (paymentsError) {
          console.error('Get contractor payments error:', paymentsError)
        }
        payments = scopedPayments || []
      }
    } else {
      const { data: allPayments, error: paymentsError } = await supabase
        .from('payments')
        .select(`id, amount_cents, payment_method, payment_date, status, created_at`)
        .eq('contractor_id', contractorId)
        .order('created_at', { ascending: false })
        .limit(20)
      if (paymentsError) {
        console.error('Get contractor payments error:', paymentsError)
      }
      payments = allPayments || []
    }

    // Fetch payment certificates (scoped to assigned projects for PMs)
    let certsQuery = supabase
      .from('payment_certificates')
      .select(`
        id,
        certificate_number,
        certified_amount_cents,
        holdback_amount_cents,
        net_payable_cents,
        status,
        created_at,
        invoice:invoices(invoice_number)
      `)
      .eq('contractor_id', contractorId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (scope.scoped) {
      certsQuery = certsQuery.in('project_id', scope.projectIds)
    }

    const { data: certificates, error: certsError } = await certsQuery

    if (certsError) {
      console.error('Get contractor certificates error:', certsError)
    }
    
    // Fetch KYC/compliance documents
    const { data: documents, error: docsError } = await supabase
      .from('vendor_kyc_documents')
      .select(`
        id,
        document_type,
        file_name,
        document_url,
        mime_type,
        status,
        expiry_date,
        uploaded_at,
        verified_at
      `)
      .eq('contractor_id', contractorId)
      .order('uploaded_at', { ascending: false })
    
    if (docsError) {
      console.error('Get contractor documents error:', docsError)
    }
    
    // Calculate financial summary
    const invoicesList = invoices || []
    const paymentsList = payments || []
    
    const financialSummary = {
      totalInvoiced: invoicesList.reduce((sum, inv) => sum + (inv.total_cents || 0), 0),
      totalCertified: invoicesList.reduce((sum, inv) => sum + (inv.total_certified_cents || 0), 0),
      totalPaid: paymentsList.filter(p => PAID_PAYMENT_STATUSES.includes(p.status as typeof PAID_PAYMENT_STATUSES[number])).reduce((sum, p) => sum + (p.amount_cents || 0), 0),
      totalHoldback: invoicesList.reduce((sum, inv) => sum + (inv.holdback_cents || 0), 0),
      pendingPayment: invoicesList
        .filter(inv => ['approved', 'pending_approval'].includes(inv.status))
        .reduce((sum, inv) => sum + (inv.net_payable_cents || 0), 0),
      invoiceCount: invoicesList.length,
      projectCount: (projects || []).length,
    }
    
    return {
      success: true,
      contractor,
      invoices: invoicesList,
      projects: projects || [],
      payments: paymentsList,
      certificates: certificates || [],
      documents: documents || [],
      financialSummary,
    }
  })
}

/**
 * Fetch a single invoice for the PM invoice-detail page, enforcing
 * assignment-based access for project managers. Replaces the previous
 * client-side query so an out-of-scope invoice cannot be opened by URL.
 *
 * Also returns `document_url` so the detail page can show the attachment.
 */
export async function getPMInvoiceById(invoiceId: string) {
  return withPermission(PERMISSIONS.INVOICES.VIEW_AP_QUEUE, async (user) => {
    const supabase = getSupabaseAdmin()

    const { data: invoice, error } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        invoice_date,
        due_date,
        total_cents,
        holdback_cents,
        net_payable_cents,
        status,
        document_url,
        project_id,
        description,
        notes,
        contractor:contractors(
          id,
          company_name,
          contact_name,
          email,
          phone,
          address_line1,
          city,
          province,
          wcb_clearance_expiry,
          status
        ),
        project:projects(
          id,
          name,
          project_number,
          address_line1,
          city,
          province,
          start_date,
          estimated_completion_date,
          current_budget_cents,
          spent_cents,
          is_active
        )
      `)
      .eq('id', invoiceId)
      .single()

    if (error || !invoice) {
      return { success: false as const, error: 'Invoice not found' }
    }

    // Enforce assignment scope for project managers.
    const scope = await resolvePmScope(user)
    if (scope.scoped && !scope.projectIds.includes(invoice.project_id)) {
      return { success: false as const, error: 'Invoice not found' }
    }

    return { success: true as const, invoice }
  })
}

/**
 * List attachments for an invoice for the PM detail page, enforcing
 * assignment-based access. Returns lightweight metadata; the actual file is
 * streamed by the role-aware `/api/documents/[id]` route.
 */
export async function getPMInvoiceDocuments(invoiceId: string) {
  return withPermission(PERMISSIONS.INVOICES.VIEW_AP_QUEUE, async (user) => {
    const supabase = getSupabaseAdmin()

    // Confirm the invoice exists and resolve its project for scope checks.
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, project_id')
      .eq('id', invoiceId)
      .single()

    if (invoiceError || !invoice) {
      return { success: false as const, documents: [], error: 'Invoice not found' }
    }

    const scope = await resolvePmScope(user)
    if (scope.scoped && !scope.projectIds.includes(invoice.project_id)) {
      return { success: false as const, documents: [], error: 'Invoice not found' }
    }

    const { data: documents, error } = await supabase
      .from('invoice_documents')
      .select('id, file_name, file_type, file_size_bytes, document_type, description, created_at')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Get PM invoice documents error:', error)
      return { success: false as const, documents: [], error: error.message }
    }

    return { success: true as const, documents: documents || [] }
  })
}
