'use server'

/**
 * Payment Certificate Actions
 * 
 * Server actions for managing payment certificates - the bridge between
 * invoices and payments. PMs create certificates to certify amounts for payment.
 */

import { createClient } from '@supabase/supabase-js'
import { withPermission } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permissions/constants'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

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
    const remainingBalance = Math.max(0, (invoice.total_cents || 0) - totalCertified)
    
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
    
    // 2. Validate invoice status - must be approved or submitted
    if (!['submitted', 'approved', 'pending_approval'].includes(invoice.status)) {
      return { success: false, error: `Cannot create certificate for invoice with status: ${invoice.status}` }
    }
    
    // 3. Calculate previous certified amount and validate new amount
    const previousCertified = invoice.total_certified_cents || 0
    const remainingBalance = invoice.total_cents - previousCertified
    
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
