'use server'

/**
 * Payment Certificate Actions
 * 
 * Server actions for managing payment certificates - the bridge between
 * invoices and payments. PMs create certificates to certify amounts for payment.
 */

// BUG-FIX (Issue E): Previously defined a local getSupabaseAdmin() using raw
// createClient() which could silently fall back to an anon-key client if env
// vars were undefined. Now uses the shared singleton from lib/supabase/admin.ts
// which includes proper env-var assertions and caching.
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { withPermission } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permissions/constants'
import { getInvoicePaymentBalance } from '@/lib/payments/payment-balance'
import { resolveInternalUserId } from '@/lib/utils/resolve-user'

// =====================================================
// TYPES
// =====================================================

export interface CreatePaymentCertificateInput {
  invoice_id: string
  certified_amount_cents: number
  description?: string
  notes?: string
  work_period_start?: string
  work_period_end?: string
}

export interface PaymentCertificate {
  id: string
  certificate_number: string
  invoice_id: string
  contractor_id: string
  project_id: string
  certified_amount_cents: number
  holdback_amount_cents: number
  net_payable_cents: number
  invoice_total_cents: number
  previous_certified_cents: number
  remaining_after_this_cents: number
  status: string
  description?: string
  notes?: string
  work_period_start?: string
  work_period_end?: string
  created_by: string
  created_at: string
  updated_at: string
  submitted_at?: string
  approved_by?: string
  approved_at?: string
  rejected_by?: string
  rejected_at?: string
  rejection_reason?: string
}

// =====================================================
// GET INVOICE WITH CERTIFICATE SUMMARY
// =====================================================

export async function getInvoiceForCertificate(invoiceId: string) {
  return withPermission(PERMISSIONS.PAYMENT_CERTIFICATES.CREATE_PAYMENT_CERTIFICATE, async (userData) => {
    const supabase = getSupabaseAdmin()
    
    // Fetch invoice with related data
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        invoice_date,
        due_date,
        subtotal_cents,
        gst_hst_cents,
        pst_cents,
        qst_cents,
        total_cents,
        holdback_percent,
        holdback_cents,
        net_payable_cents,
        total_certified_cents,
        total_paid_cents,
        status,
        source,
        document_url,
        created_at,
        contractor:contractors(
          id,
          company_name,
          contact_name,
          email
        ),
        project:projects(
          id,
          name,
          project_number,
          current_budget_cents,
          spent_cents
        )
      `)
      .eq('id', invoiceId)
      .single()
    
    if (invoiceError) {
      console.error('Get invoice error:', invoiceError)
      return { success: false, error: invoiceError.message, invoice: null, certificates: [] }
    }
    
    // Fetch existing certificates for this invoice
    const { data: certificates, error: certError } = await supabase
      .from('payment_certificates')
      .select(`
        id,
        certificate_number,
        certified_amount_cents,
        holdback_amount_cents,
        net_payable_cents,
        status,
        description,
        work_period_start,
        work_period_end,
        created_at,
        submitted_at,
        approved_at
      `)
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: true })
    
    if (certError) {
      console.error('Get certificates error:', certError)
    }
    
    // Calculate summary
    const totalCertified = (certificates || [])
      .filter(c => c.status !== 'rejected' && c.status !== 'cancelled')
      .reduce((sum, c) => sum + (c.certified_amount_cents || 0), 0)
      
    // Use authoritative payment balance
    const invBalance = await getInvoicePaymentBalance(supabase, invoiceId, invoice.net_payable_cents || 0)
    const remainingBalance = Math.max(0, (invoice.total_cents || 0) - Math.max(totalCertified, invBalance.totalPaidCents))
    
    return { 
      success: true, 
      invoice: {
        ...invoice,
        calculated_total_certified: totalCertified,
        calculated_remaining_balance: remainingBalance,
      },
      certificates: certificates || [],
      userId: userData.id
    }
  })
}

// =====================================================
// GET PAYMENT CERTIFICATE BY ID
// =====================================================

export async function getPaymentCertificateById(certificateId: string) {
  return withPermission(PERMISSIONS.PAYMENT_CERTIFICATES.VIEW_PAYMENT_HISTORY, async () => {
    const supabase = getSupabaseAdmin()
    
    const { data: certificate, error } = await supabase
      .from('payment_certificates')
      .select(`
        id,
        certificate_number,
        invoice_id,
        certified_amount_cents,
        holdback_amount_cents,
        net_payable_cents,
        status,
        description,
        notes,
        work_period_start,
        work_period_end,
        created_at,
        approved_at,
        approved_by,
        paid_at,
        paid_by,
        invoice:invoices(
          id,
          invoice_number,
          total_cents,
          holdback_percent,
          contractor:contractors(
            company_name,
            preferred_payment_method,
            etransfer_email
          ),
          project:projects(name, project_number)
        ),
        payment:payments(
          id,
          payment_method,
          amount_cents,
          payment_date,
          cheque_number,
          etransfer_reference,
          wire_reference,
          eft_file_id,
          status,
          created_at
        )
      `)
      .eq('id', certificateId)
      .single()
    
    if (error) {
      console.error('Get certificate error:', error)
      return { success: false, error: error.message }
    }
    
    // payments -> payment_certificates is one-to-many, so the embedded payment
    // comes back as an array. The certificate page expects ONE payment object
    // (or null): prefer a cleared payment, then the newest one that is not
    // cancelled/returned, then the newest of all.
    const rawPayment = (certificate as { payment?: unknown }).payment
    if (Array.isArray(rawPayment)) {
      const byNewest = [...rawPayment].sort((a, b) =>
        String(b?.created_at ?? '').localeCompare(String(a?.created_at ?? ''))
      )
      const payment =
        byNewest.find((p) => p?.status === 'cleared') ??
        byNewest.find((p) => p?.status !== 'cancelled' && p?.status !== 'returned') ??
        byNewest[0] ??
        null
      return { success: true, certificate: { ...certificate, payment } }
    }

    return { success: true, certificate }
  })
}

// =====================================================
// CREATE PAYMENT CERTIFICATE
// =====================================================

export async function createPaymentCertificate(input: CreatePaymentCertificateInput) {
  return withPermission(PERMISSIONS.PAYMENT_CERTIFICATES.CREATE_PAYMENT_CERTIFICATE, async (userData) => {
    const supabase = getSupabaseAdmin()
    
    // 1. Fetch invoice to validate and get data
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        total_cents,
        holdback_percent,
        holdback_cents,
        net_payable_cents,
        total_certified_cents,
        status,
        contractor_id,
        project_id
      `)
      .eq('id', input.invoice_id)
      .single()
    
    if (invoiceError || !invoice) {
      console.error('Fetch invoice error:', invoiceError)
      return { success: false, error: 'Invoice not found' }
    }
    
    // 2. Validate invoice status - must be approved, submitted, or partially paid
    if (!['submitted', 'approved', 'pending_approval', 'partially_paid'].includes(invoice.status)) {
      return { success: false, error: `Cannot create certificate for invoice with status: ${invoice.status}` }
    }
    
    // 3. Calculate previous certified amount and validate new amount
    const previousCertified = invoice.total_certified_cents || 0
    const invBalance = await getInvoicePaymentBalance(supabase, input.invoice_id, invoice.net_payable_cents || 0)
    const remainingBalance = Math.max(0, invoice.total_cents - Math.max(previousCertified, invBalance.totalPaidCents))
    
    if (input.certified_amount_cents <= 0) {
      return { success: false, error: 'Certificate amount must be greater than 0' }
    }
    
    if (input.certified_amount_cents > remainingBalance) {
      return { 
        success: false, 
        error: `Certificate amount ($${(input.certified_amount_cents / 100).toFixed(2)}) exceeds remaining balance ($${(remainingBalance / 100).toFixed(2)})` 
      }
    }
    
    // 4. Holdback is applied at the invoice level, not per certificate
    const holdbackAmountCents = 0
    const netPayableCents = input.certified_amount_cents
    
    // 5. Generate certificate number
    const { data: countData } = await supabase
      .from('payment_certificates')
      .select('id')
      .eq('invoice_id', input.invoice_id)
    
    const certCount = (countData?.length || 0) + 1
    const certificateNumber = `PC-${invoice.invoice_number}-${String(certCount).padStart(2, '0')}`
    
    // 6. Create the payment certificate
    const { data: certificate, error: createError } = await supabase
      .from('payment_certificates')
      .insert({
        invoice_id: input.invoice_id,
        contractor_id: invoice.contractor_id,
        project_id: invoice.project_id,
        certificate_number: certificateNumber,
        certified_amount_cents: input.certified_amount_cents,
        holdback_amount_cents: holdbackAmountCents,
        net_payable_cents: netPayableCents,
        invoice_total_cents: invoice.total_cents,
        previous_certified_cents: previousCertified,
        remaining_after_this_cents: remainingBalance - input.certified_amount_cents,
        status: 'draft',
        description: input.description || null,
        notes: input.notes || null,
        work_period_start: input.work_period_start || null,
        work_period_end: input.work_period_end || null,
      })
      .select()
      .single()
    
    if (createError) {
      console.error('Create certificate error:', createError)
      return { success: false, error: createError.message }
    }
    
    // 7. Update invoice total_certified_cents (trigger should handle this, but update as backup)
    await supabase
      .from('invoices')
      .update({
        total_certified_cents: previousCertified + input.certified_amount_cents,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.invoice_id)
    
    // 8. Log the action
    await supabase.from('audit_logs').insert({
      action: 'payment_certificate_created',
      entity_type: 'payment_certificate',
      entity_id: certificate.id,
      user_id: userData.id,
      description: `Created payment certificate ${certificateNumber} for $${(input.certified_amount_cents / 100).toFixed(2)}`,
      new_values: {
        certificate_number: certificateNumber,
        certified_amount_cents: input.certified_amount_cents,
        holdback_amount_cents: holdbackAmountCents,
        net_payable_cents: netPayableCents,
      },
    })
    
    return { 
      success: true, 
      certificate,
      message: `Payment certificate ${certificateNumber} created successfully`
    }
  })
}

// =====================================================
// SUBMIT PAYMENT CERTIFICATE FOR APPROVAL
// =====================================================

export async function submitPaymentCertificate(certificateId: string) {
  return withPermission(PERMISSIONS.PAYMENT_CERTIFICATES.CREATE_PAYMENT_CERTIFICATE, async (userData) => {
    const supabase = getSupabaseAdmin()
    
    // Fetch certificate
    const { data: certificate, error: fetchError } = await supabase
      .from('payment_certificates')
      .select('id, certificate_number, status, created_by')
      .eq('id', certificateId)
      .single()
    
    if (fetchError || !certificate) {
      return { success: false, error: 'Certificate not found' }
    }
    
    if (certificate.status !== 'draft') {
      return { success: false, error: `Cannot submit certificate with status: ${certificate.status}` }
    }
    
    // Update status to submitted
    const { error: updateError } = await supabase
      .from('payment_certificates')
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', certificateId)
    
    if (updateError) {
      console.error('Submit certificate error:', updateError)
      return { success: false, error: updateError.message }
    }
    
    // Log the action
    await supabase.from('audit_logs').insert({
      action: 'payment_certificate_submitted',
      entity_type: 'payment_certificate',
      entity_id: certificateId,
      user_id: userData.id,
      description: `Submitted payment certificate ${certificate.certificate_number} for approval`,
    })
    
    return { success: true, message: 'Certificate submitted for approval' }
  })
}

// =====================================================
// APPROVE PAYMENT CERTIFICATE
// =====================================================

export async function approvePaymentCertificate(certificateId: string) {
  return withPermission(PERMISSIONS.INVOICES.APPROVE_INVOICES, async (userData) => {
    const supabase = getSupabaseAdmin()
    
    // Fetch certificate
    const { data: certificate, error: fetchError } = await supabase
      .from('payment_certificates')
      .select('id, certificate_number, status, invoice_id, net_payable_cents')
      .eq('id', certificateId)
      .single()
    
    if (fetchError || !certificate) {
      return { success: false, error: 'Certificate not found' }
    }
    
    if (certificate.status !== 'submitted') {
      return { success: false, error: `Cannot approve certificate with status: ${certificate.status}` }
    }
    
    // Update status to approved
    const { error: updateError } = await supabase
      .from('payment_certificates')
      .update({
        status: 'approved',
        approved_by: userData.id,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', certificateId)
    
    if (updateError) {
      console.error('Approve certificate error:', updateError)
      return { success: false, error: updateError.message }
    }
    
    // Log the action
    await supabase.from('audit_logs').insert({
      action: 'payment_certificate_approved',
      entity_type: 'payment_certificate',
      entity_id: certificateId,
      user_id: userData.id,
      description: `Approved payment certificate ${certificate.certificate_number}`,
    })
    
    return { success: true, message: 'Certificate approved successfully' }
  })
}

// =====================================================
// REJECT PAYMENT CERTIFICATE
// =====================================================

export async function rejectPaymentCertificate(certificateId: string, reason: string) {
  return withPermission(PERMISSIONS.INVOICES.REJECT_INVOICES, async (userData) => {
    const supabase = getSupabaseAdmin()
    
    if (!reason || reason.trim().length === 0) {
      return { success: false, error: 'Rejection reason is required' }
    }
    
    // Fetch certificate
    const { data: certificate, error: fetchError } = await supabase
      .from('payment_certificates')
      .select('id, certificate_number, status, invoice_id, certified_amount_cents')
      .eq('id', certificateId)
      .single()
    
    if (fetchError || !certificate) {
      return { success: false, error: 'Certificate not found' }
    }
    
    if (certificate.status !== 'submitted') {
      return { success: false, error: `Cannot reject certificate with status: ${certificate.status}` }
    }
    
    // Update status to rejected
    const { error: updateError } = await supabase
      .from('payment_certificates')
      .update({
        status: 'rejected',
        rejected_by: userData.id,
        rejected_at: new Date().toISOString(),
        rejection_reason: reason.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', certificateId)
    
    if (updateError) {
      console.error('Reject certificate error:', updateError)
      return { success: false, error: updateError.message }
    }
    
    // Revert the total_certified_cents on the invoice
    const { data: invoice } = await supabase
      .from('invoices')
      .select('total_certified_cents')
      .eq('id', certificate.invoice_id)
      .single()
    
    if (invoice) {
      const newTotalCertified = Math.max(0, (invoice.total_certified_cents || 0) - certificate.certified_amount_cents)
      await supabase
        .from('invoices')
        .update({
          total_certified_cents: newTotalCertified,
          updated_at: new Date().toISOString(),
        })
        .eq('id', certificate.invoice_id)
    }
    
    // Log the action
    await supabase.from('audit_logs').insert({
      action: 'payment_certificate_rejected',
      entity_type: 'payment_certificate',
      entity_id: certificateId,
      user_id: userData.id,
      description: `Rejected payment certificate ${certificate.certificate_number}: ${reason}`,
    })
    
    return { success: true, message: 'Certificate rejected' }
  })
}

// =====================================================
// GET PAYMENT CERTIFICATES FOR INVOICE
// =====================================================

export async function getPaymentCertificates(invoiceId: string) {
  return withPermission(PERMISSIONS.PAYMENT_CERTIFICATES.VIEW_PAYMENT_HISTORY, async () => {
    const supabase = getSupabaseAdmin()
    
    const { data: certificates, error } = await supabase
      .from('payment_certificates')
      .select(`
        id,
        certificate_number,
        invoice_id,
        contractor_id,
        project_id,
        certified_amount_cents,
        holdback_amount_cents,
        net_payable_cents,
        invoice_total_cents,
        previous_certified_cents,
        remaining_after_this_cents,
        status,
        description,
        notes,
        work_period_start,
        work_period_end,
        created_by,
        created_at,
        submitted_at,
        approved_by,
        approved_at,
        rejected_by,
        rejected_at,
        rejection_reason
      `)
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: true })
    
    if (error) {
      console.error('Get certificates error:', error)
      return { success: false, certificates: [], error: error.message }
    }
    
    return { success: true, certificates: certificates || [] }
  })
}

// =====================================================
// GET APPROVED CERTIFICATES PENDING PAYMENT
// =====================================================

export async function getApprovedCertificatesPendingPayment() {
  return withPermission(PERMISSIONS.PAYMENTS.PROCESS_PAYMENTS, async () => {
    const supabase = getSupabaseAdmin()
    
    const { data: certificates, error } = await supabase
      .from('payment_certificates')
      .select(`
        id,
        certificate_number,
        certified_amount_cents,
        holdback_amount_cents,
        net_payable_cents,
        status,
        approved_at,
        invoice:invoices(
          id,
          invoice_number,
          contractor:contractors(id, company_name, bank_name, bank_account_number)
        ),
        project:projects(id, name, project_number)
      `)
      .eq('status', 'approved')
      .order('approved_at', { ascending: true })
    
    if (error) {
      console.error('Get approved certificates error:', error)
      return { success: false, certificates: [], error: error.message }
    }
    
    return { success: true, certificates: certificates || [] }
  })
}

// =====================================================
// DELETE DRAFT CERTIFICATE
// =====================================================

export async function deleteDraftCertificate(certificateId: string) {
  return withPermission(PERMISSIONS.PAYMENT_CERTIFICATES.EDIT_PAYMENT_CERTIFICATE, async (userData) => {
    const supabase = getSupabaseAdmin()
    
    // Fetch certificate
    const { data: certificate, error: fetchError } = await supabase
      .from('payment_certificates')
      .select('id, certificate_number, status, invoice_id, certified_amount_cents, created_by')
      .eq('id', certificateId)
      .single()
    
    if (fetchError || !certificate) {
      return { success: false, error: 'Certificate not found' }
    }
    
    if (certificate.status !== 'draft') {
      return { success: false, error: 'Only draft certificates can be deleted' }
    }
    
    // Delete the certificate
    const { error: deleteError } = await supabase
      .from('payment_certificates')
      .delete()
      .eq('id', certificateId)
    
    if (deleteError) {
      console.error('Delete certificate error:', deleteError)
      return { success: false, error: deleteError.message }
    }
    
    // Revert the total_certified_cents on the invoice
    const { data: invoice } = await supabase
      .from('invoices')
      .select('total_certified_cents')
      .eq('id', certificate.invoice_id)
      .single()
    
    if (invoice) {
      const newTotalCertified = Math.max(0, (invoice.total_certified_cents || 0) - certificate.certified_amount_cents)
      await supabase
        .from('invoices')
        .update({
          total_certified_cents: newTotalCertified,
          updated_at: new Date().toISOString(),
        })
        .eq('id', certificate.invoice_id)
    }
    
    // Log the action
    await supabase.from('audit_logs').insert({
      action: 'payment_certificate_deleted',
      entity_type: 'payment_certificate',
      entity_id: certificateId,
      user_id: userData.id,
      description: `Deleted draft payment certificate ${certificate.certificate_number}`,
    })
    
    return { success: true, message: 'Draft certificate deleted' }
  })
}

// =====================================================
// ADMIN CERTIFICATE OVERRIDES
// =====================================================
//
// Business rules (agreed Nov 2026):
// - Only an admin can use these actions.
// - Admin can EDIT or REJECT a certificate only while it is 'pending' or
//   'approved'. Drafts and rejected certificates belong to the PM; paid
//   certificates are never touched.
// - Editing an approved certificate keeps it 'approved'.
// - Every admin change is written to audit_logs and shown in the
//   certificate's Change History (admin, PM and accountant only).

const ADMIN_EDITABLE_STATUSES = ['pending', 'approved'] as const
const ADMIN_CHANGE_SOURCE = 'admin_certificate_change'
const INTERNAL_ROLES = ['admin', 'project_manager', 'accountant']

type AdminCertChangeValues = {
  certified_amount_cents?: number
  description?: string | null
  work_period_start?: string | null
  work_period_end?: string | null
  status?: string
  rejection_reason?: string
}

/**
 * Admin edit of a pending or approved certificate (amount, description,
 * work period). Status is NOT changed. Uses the same balance rule as the
 * database totals trigger: other non-rejected, non-cancelled certificates
 * on the invoice + this one may not exceed invoice total minus holdback.
 */
export async function adminUpdatePaymentCertificate(input: {
  certificate_id: string
  certified_amount_cents: number
  description?: string | null
  work_period_start?: string | null
  work_period_end?: string | null
  reason: string
}) {
  return withPermission(PERMISSIONS.PAYMENT_CERTIFICATES.EDIT_PAYMENT_CERTIFICATE, async (userData) => {
    if (userData.role !== 'admin') {
      return { success: false, error: 'Permission denied: admin role required' }
    }
    if (!input.reason?.trim()) {
      return { success: false, error: 'A reason for the change is required' }
    }
    if (!Number.isInteger(input.certified_amount_cents) || input.certified_amount_cents <= 0) {
      return { success: false, error: 'Certificate amount must be greater than 0' }
    }
    if (
      input.work_period_start &&
      input.work_period_end &&
      input.work_period_end < input.work_period_start
    ) {
      return { success: false, error: 'Work period end cannot be before the start' }
    }

    const supabase = getSupabaseAdmin()

    const { data: cert, error: certError } = await supabase
      .from('payment_certificates')
      .select('id, certificate_number, status, invoice_id, certified_amount_cents, net_payable_cents, remaining_after_this_cents, description, work_period_start, work_period_end')
      .eq('id', input.certificate_id)
      .single()

    if (certError || !cert) {
      return { success: false, error: 'Certificate not found' }
    }
    if (!(ADMIN_EDITABLE_STATUSES as readonly string[]).includes(cert.status)) {
      return {
        success: false,
        error: `Certificates with status '${cert.status}' cannot be edited by an admin. Only pending or approved certificates can be edited.`,
      }
    }

    const [invoiceResult, otherCertsResult, internalUserId] = await Promise.all([
      supabase
        .from('invoices')
        .select('id, total_cents, holdback_cents')
        .eq('id', cert.invoice_id)
        .single(),
      supabase
        .from('payment_certificates')
        .select('certified_amount_cents')
        .eq('invoice_id', cert.invoice_id)
        .neq('id', cert.id)
        .not('status', 'in', '(rejected,cancelled)'),
      resolveInternalUserId(userData.id, supabase),
    ])

    if (invoiceResult.error || !invoiceResult.data) {
      return { success: false, error: 'Invoice not found' }
    }
    if (otherCertsResult.error) {
      return { success: false, error: 'Failed to check existing certificates' }
    }
    if (!internalUserId) {
      return { success: false, error: 'Could not resolve internal user ID' }
    }

    const invoice = invoiceResult.data
    const otherCertifiedCents = (otherCertsResult.data || []).reduce(
      (sum, c) => sum + (c.certified_amount_cents || 0),
      0
    )
    const availableCents = invoice.total_cents - (invoice.holdback_cents || 0) - otherCertifiedCents

    if (input.certified_amount_cents > availableCents) {
      return {
        success: false,
        error: `Certificate amount exceeds available balance. Available: $${(Math.max(availableCents, 0) / 100).toFixed(2)}`,
      }
    }

    const oldValues: AdminCertChangeValues = {
      certified_amount_cents: cert.certified_amount_cents,
      description: cert.description ?? null,
      work_period_start: cert.work_period_start ?? null,
      work_period_end: cert.work_period_end ?? null,
    }
    const newValues: AdminCertChangeValues = {
      certified_amount_cents: input.certified_amount_cents,
      description: input.description?.trim() || null,
      work_period_start: input.work_period_start || null,
      work_period_end: input.work_period_end || null,
    }

    // Only record fields that actually changed
    const changedKeys = (Object.keys(newValues) as (keyof AdminCertChangeValues)[]).filter(
      (k) => (oldValues[k] ?? null) !== (newValues[k] ?? null)
    )
    if (changedKeys.length === 0) {
      return { success: false, error: 'No changes to save' }
    }

    // Guarded update: only succeeds if the cert is STILL pending/approved,
    // so a certificate paid a moment ago can never be modified.
    const { data: updated, error: updateError } = await supabase
      .from('payment_certificates')
      .update({
        certified_amount_cents: newValues.certified_amount_cents,
        holdback_amount_cents: 0, // holdback is invoice-level only
        net_payable_cents: newValues.certified_amount_cents,
        remaining_after_this_cents: availableCents - input.certified_amount_cents,
        description: newValues.description,
        work_period_start: newValues.work_period_start,
        work_period_end: newValues.work_period_end,
        updated_at: new Date().toISOString(),
      })
      .eq('id', cert.id)
      .in('status', [...ADMIN_EDITABLE_STATUSES])
      .select()
      .maybeSingle()

    if (updateError) {
      console.error('[adminUpdatePaymentCertificate] update error:', updateError)
      return { success: false, error: updateError.message }
    }
    if (!updated) {
      return { success: false, error: 'This certificate changed status while you were editing (it may have just been paid). Please refresh.' }
    }

    const { error: auditError } = await supabase.from('audit_logs').insert({
      action: 'update',
      entity_type: 'payment_certificate',
      entity_id: cert.id,
      user_id: internalUserId,
      user_email: userData.email ?? null,
      user_role: 'admin',
      description: `Admin edited certificate ${cert.certificate_number}: ${input.reason.trim()}`,
      old_values: { change_source: ADMIN_CHANGE_SOURCE, ...pick(oldValues, changedKeys) },
      new_values: {
        change_source: ADMIN_CHANGE_SOURCE,
        change_type: 'edit',
        reason: input.reason.trim(),
        status: cert.status,
        ...pick(newValues, changedKeys),
      },
    })

    if (auditError) {
      // History is required for admin changes — undo the edit rather than
      // leave an unrecorded modification.
      console.error('[adminUpdatePaymentCertificate] audit insert failed, reverting:', auditError)
      await supabase
        .from('payment_certificates')
        .update({
          certified_amount_cents: cert.certified_amount_cents,
          net_payable_cents: cert.net_payable_cents,
          remaining_after_this_cents: cert.remaining_after_this_cents,
          description: cert.description,
          work_period_start: cert.work_period_start,
          work_period_end: cert.work_period_end,
        })
        .eq('id', cert.id)
        .in('status', [...ADMIN_EDITABLE_STATUSES])
      return { success: false, error: 'Could not record the change history, so the edit was not saved. Please try again.' }
    }

    return { success: true, certificate: updated }
  })
}

/**
 * Admin rejection of a pending or approved certificate. Reason is required.
 * The certificate goes to 'rejected' and follows the normal PM path
 * (reset to draft → edit → resubmit).
 */
export async function adminRejectPaymentCertificate(input: {
  certificate_id: string
  reason: string
}) {
  return withPermission(PERMISSIONS.PAYMENT_CERTIFICATES.EDIT_PAYMENT_CERTIFICATE, async (userData) => {
    if (userData.role !== 'admin') {
      return { success: false, error: 'Permission denied: admin role required' }
    }
    if (!input.reason?.trim()) {
      return { success: false, error: 'Rejection reason is required' }
    }

    const supabase = getSupabaseAdmin()

    const [{ data: cert, error: certError }, internalUserId] = await Promise.all([
      supabase
        .from('payment_certificates')
        .select('id, certificate_number, status, approved_by, approved_at')
        .eq('id', input.certificate_id)
        .single(),
      resolveInternalUserId(userData.id, supabase),
    ])

    if (certError || !cert) {
      return { success: false, error: 'Certificate not found' }
    }
    if (!internalUserId) {
      return { success: false, error: 'Could not resolve internal user ID' }
    }
    if (!(ADMIN_EDITABLE_STATUSES as readonly string[]).includes(cert.status)) {
      return {
        success: false,
        error: `Certificates with status '${cert.status}' cannot be rejected by an admin. Only pending or approved certificates can be rejected.`,
      }
    }

    const now = new Date().toISOString()
    const reason = input.reason.trim()

    const { data: updated, error: updateError } = await supabase
      .from('payment_certificates')
      .update({
        status: 'rejected',
        rejection_reason: reason,
        rejected_by: internalUserId,
        rejected_at: now,
        approved_by: null,
        approved_at: null,
        updated_at: now,
      })
      .eq('id', cert.id)
      .in('status', [...ADMIN_EDITABLE_STATUSES])
      .select()
      .maybeSingle()

    if (updateError) {
      console.error('[adminRejectPaymentCertificate] update error:', updateError)
      return { success: false, error: updateError.message }
    }
    if (!updated) {
      return { success: false, error: 'This certificate changed status (it may have just been paid). Please refresh.' }
    }

    const { error: auditError } = await supabase.from('audit_logs').insert({
      action: 'reject',
      entity_type: 'payment_certificate',
      entity_id: cert.id,
      user_id: internalUserId,
      user_email: userData.email ?? null,
      user_role: 'admin',
      description: `Admin rejected certificate ${cert.certificate_number}: ${reason}`,
      old_values: { change_source: ADMIN_CHANGE_SOURCE, status: cert.status },
      new_values: {
        change_source: ADMIN_CHANGE_SOURCE,
        change_type: 'reject',
        reason,
        status: 'rejected',
      },
    })

    if (auditError) {
      console.error('[adminRejectPaymentCertificate] audit insert failed, reverting:', auditError)
      await supabase
        .from('payment_certificates')
        .update({
          status: cert.status,
          rejection_reason: null,
          rejected_by: null,
          rejected_at: null,
          approved_by: cert.approved_by,
          approved_at: cert.approved_at,
        })
        .eq('id', cert.id)
        .eq('status', 'rejected')
      return { success: false, error: 'Could not record the change history, so the rejection was not saved. Please try again.' }
    }

    return { success: true, certificate: updated }
  })
}

export interface CertificateChangeHistoryEntry {
  id: string
  created_at: string
  change_type: 'edit' | 'reject'
  changed_by: string
  reason: string | null
  old_values: AdminCertChangeValues
  new_values: AdminCertChangeValues
}

/**
 * Viewer role + admin change history for the certificate detail page.
 * One call so the page doesn't need separate role and history requests.
 * History is returned ONLY to internal users (admin, PM, accountant) —
 * never to contractors.
 */
export async function getCertificateViewerContext(certificateId: string): Promise<{
  success: boolean
  role: string | null
  history: CertificateChangeHistoryEntry[]
  error?: string
}> {
  const result = await withPermission(PERMISSIONS.PAYMENT_CERTIFICATES.VIEW_PAYMENT_HISTORY, async (userData) => {
    if (!INTERNAL_ROLES.includes(userData.role)) {
      return { success: true, role: userData.role, history: [] }
    }

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('audit_logs')
      .select('id, created_at, user_email, old_values, new_values, user:users(first_name, last_name)')
      .eq('entity_type', 'payment_certificate')
      .eq('entity_id', certificateId)
      .eq('new_values->>change_source', ADMIN_CHANGE_SOURCE)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      console.error('[getCertificateViewerContext] history error:', error)
      return { success: false, role: userData.role, history: [], error: 'Failed to load change history' }
    }

    const history: CertificateChangeHistoryEntry[] = (data || []).map((row) => {
      const nv = (row.new_values || {}) as Record<string, unknown>
      const ov = (row.old_values || {}) as Record<string, unknown>
      const u = (Array.isArray(row.user) ? row.user[0] : row.user) as
        | { first_name?: string; last_name?: string }
        | null
      const name = [u?.first_name, u?.last_name].filter(Boolean).join(' ')
      return {
        id: row.id as string,
        created_at: row.created_at as string,
        change_type: nv.change_type === 'reject' ? 'reject' : 'edit',
        changed_by: name || (row.user_email as string) || 'Admin',
        reason: (nv.reason as string) ?? null,
        old_values: stripMeta(ov),
        new_values: stripMeta(nv),
      }
    })

    return { success: true, role: userData.role, history }
  })

  if ('role' in result) return result
  return { success: false, role: null, history: [], error: result.error }
}

function pick<T extends object>(obj: T, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {}
  for (const k of keys) out[k] = obj[k]
  return out
}

function stripMeta(values: Record<string, unknown>): AdminCertChangeValues {
  const { change_source: _s, change_type: _t, reason: _r, ...rest } = values
  void _s; void _t; void _r
  return rest as AdminCertChangeValues
}
