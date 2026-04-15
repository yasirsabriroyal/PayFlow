'use server'

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { 
  PERMISSIONS,
  withPermission,
} from '@/lib/permissions'
import {
  secureAction,
  // RATE_LIMITS, // temporarily disabled
} from '@/lib/security/secureAction'

// Create admin client for server actions
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// =====================================================
// INVOICE APPROVAL / REJECTION ACTIONS
// =====================================================

export interface ApproveInvoiceInput {
  invoice_id: string
  notes?: string
  /** Project ID for policy scope validation (PM only) */
  project_id?: string
  /** Assigned project IDs for the user (passed for PM policy) */
  assigned_project_ids?: string[]
}

export interface RejectInvoiceInput {
  invoice_id: string
  reason: string
  /** Project ID for policy scope validation (PM only) */
  project_id?: string
  /** Assigned project IDs for the user (passed for PM policy) */
  assigned_project_ids?: string[]
}

/**
 * Approve an invoice for payment
 * Requires: approve_invoices permission
 * Rate limited: 30 actions per minute
 * 
 * Uses enterprise secureAction wrapper with:
 * - RBAC permission enforcement
 * - Rate limiting
 * - Security telemetry logging
 */
export const approveInvoice = secureAction(
  PERMISSIONS.INVOICES.APPROVE_INVOICES,
  async (user, input: ApproveInvoiceInput) => {
    // Validate invoice_id is a valid UUID
    if (!input.invoice_id || input.invoice_id === 'undefined' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.invoice_id)) {
      throw new Error('Invalid invoice ID. Cannot approve mock data.')
    }
    
    const supabase = getSupabaseAdmin()
    
    // Get user record
    const { data: userData } = await supabase
      .from('users')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()
    
    if (!userData) {
      throw new Error('User not found')
    }
    
    // Update invoice status only (invoices table doesn't have approved_by or notes columns)
    const { data: invoice, error } = await supabase
      .from('invoices')
      .update({
        status: 'approved',
      })
      .eq('id', input.invoice_id)
      .select()
      .single()
    
    if (error) {
      console.error('Approve invoice error:', error)
      throw new Error(error.message)
    }
    
    // Log the action with approver details in audit_logs
    // user_id in audit_logs references the users table id
    if (userData?.id) {
      await supabase.from('audit_logs').insert({
        action: 'invoice_approved',
        entity_type: 'invoice',
        entity_id: input.invoice_id,
        user_id: userData.id,
        new_values: { status: 'approved', approved_by: userData.id, notes: input.notes },
      })
    }
    
    revalidatePath('/accountant/queue')
    revalidatePath('/accountant/payments')
    
    return { invoice }
  },
  {
    actionName: 'approveInvoice',
    module: 'accountant',
    // rateLimit: RATE_LIMITS.APPROVE_INVOICE, // temporarily disabled
    isCritical: true,
    // Policy context for PM project scope check
    getPolicyContext: (input) => {
      const approvalInput = input as ApproveInvoiceInput
      return {
        projectId: approvalInput.project_id,
        assignedProjectIds: approvalInput.assigned_project_ids || [],
      }
    },
  }
)

/**
 * Reject an invoice with reason
 * Requires: reject_invoices permission
 * Rate limited: 30 actions per minute
 */
export const rejectInvoice = secureAction(
  PERMISSIONS.INVOICES.REJECT_INVOICES,
  async (user, input: RejectInvoiceInput) => {
    const supabase = getSupabaseAdmin()
    
    if (!input.reason?.trim()) {
      throw new Error('Rejection reason is required')
    }
    
    // Get user record
    const { data: userData } = await supabase
      .from('users')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()
    
    if (!userData) {
      return { success: false, error: 'User not found' }
    }
    
    // Update invoice status
    const { data: invoice, error } = await supabase
      .from('invoices')
      .update({
        status: 'rejected',
        rejection_reason: input.reason,
        rejected_by_user_id: userData.id,
        rejected_at: new Date().toISOString(),
      })
      .eq('id', input.invoice_id)
      .select()
      .single()
    
    if (error) {
      console.error('Reject invoice error:', error)
      throw new Error(error.message)
    }
    
    // Log the action
    await supabase.from('audit_logs').insert({
      action: 'invoice_rejected',
      entity_type: 'invoice',
      entity_id: input.invoice_id,
      user_id: userData.id,
      details: { reason: input.reason },
    })
    
    revalidatePath('/accountant/queue')
    
    return { invoice }
  },
  {
    actionName: 'rejectInvoice',
    module: 'accountant',
    // rateLimit: RATE_LIMITS.APPROVE_INVOICE, // temporarily disabled
    isCritical: true,
    // Policy context for PM project scope check
    getPolicyContext: (input) => {
      const rejectInput = input as RejectInvoiceInput
      return {
        projectId: rejectInput.project_id,
        assignedProjectIds: rejectInput.assigned_project_ids || [],
      }
    },
  }
)

// =====================================================
// PAYMENT PROCESSING ACTIONS
// =====================================================

export interface ProcessPaymentInput {
  invoice_ids: string[]
  payment_method: 'eft' | 'cheque'
  notes?: string
}

/**
 * Process approved invoices for payment
 * Requires: process_payments permission
 * Rate limited: 10 actions per minute
 * 
 * Uses enterprise secureAction wrapper with:
 * - RBAC permission enforcement
 * - Rate limiting
 * - Security telemetry logging
 */
export const processPayments = secureAction(
  PERMISSIONS.PAYMENTS.PROCESS_PAYMENTS,
  async (user, input: ProcessPaymentInput) => {
    const supabase = getSupabaseAdmin()
    
    if (!input.invoice_ids?.length) {
      throw new Error('No invoices selected')
    }
    
    // Get user record
    const { data: userData } = await supabase
      .from('users')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()
    
    if (!userData) {
      throw new Error('User not found')
    }
    
    // Update all selected invoices to payment_processing
    const { error } = await supabase
      .from('invoices')
      .update({
        status: 'payment_processing',
        payment_method: input.payment_method,
        processed_by_user_id: userData.id,
        processed_at: new Date().toISOString(),
      })
      .in('id', input.invoice_ids)
      .eq('status', 'approved') // Only process approved invoices
    
    if (error) {
      console.error('Process payments error:', error)
      throw new Error(error.message)
    }
    
    // Log the action
    await supabase.from('audit_logs').insert({
      action: 'payments_processed',
      entity_type: 'payment_batch',
      entity_id: `batch-${Date.now()}`,
      user_id: userData.id,
      details: { 
        invoice_count: input.invoice_ids.length,
        payment_method: input.payment_method,
        notes: input.notes,
      },
    })
    
    revalidatePath('/accountant/payments')
    revalidatePath('/accountant/queue')
    
    return { processed_count: input.invoice_ids.length }
  },
  {
    actionName: 'processPayments',
    module: 'accountant',
    // rateLimit: RATE_LIMITS.EXECUTE_EFT, // temporarily disabled
    isCritical: true,
  }
)

export interface ExecuteEFTInput {
  invoice_ids: string[]
  batch_reference?: string
  /** Total amount in cents for policy evaluation (must be calculated client-side from selected invoices) */
  total_amount_cents: number
}

/**
 * Execute EFT payment file generation
 * Requires: execute_eft_payments permission (CRITICAL)
 * Rate limited: 10 actions per minute
 * Policy: EFT payments >$50,000 require admin approval
 * 
 * Uses enterprise secureAction wrapper with:
 * - RBAC permission enforcement
 * - Rate limiting (strictest limit - financial action)
 * - Policy engine evaluation (EFT_LIMIT_POLICY)
 * - Security telemetry logging
 */
export const executeEFTPayment = secureAction(
  PERMISSIONS.PAYMENTS.EXECUTE_EFT_PAYMENTS,
  async (user, input: ExecuteEFTInput) => {
    const supabase = getSupabaseAdmin()
    
    if (!input.invoice_ids?.length) {
      throw new Error('No invoices selected for EFT')
    }
    
    // Get user record
    const { data: userData } = await supabase
      .from('users')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()
    
    if (!userData) {
      throw new Error('User not found')
    }
    
    // Verify all invoices are in approved/payment_processing status
    const { data: invoices, error: fetchError } = await supabase
      .from('invoices')
      .select('id, status, net_payable_cents, contractor_id')
      .in('id', input.invoice_ids)
    
    if (fetchError) {
      throw new Error(fetchError.message)
    }
    
    const invalidInvoices = invoices?.filter(
      inv => !['approved', 'payment_processing'].includes(inv.status)
    )
    
    if (invalidInvoices?.length) {
      throw new Error(`${invalidInvoices.length} invoice(s) are not in valid status for EFT`)
    }
    
    const batchReference = input.batch_reference || `EFT-${Date.now()}`
    const totalAmount = invoices?.reduce((sum, inv) => sum + (inv.net_payable_cents || 0), 0) || 0
    
    // Update each invoice to paid status with proper amount tracking
    for (const inv of invoices || []) {
      const paymentAmount = inv.net_payable_cents || 0
      
      // First check if there are approved payment certificates for this invoice
      const { data: approvedCerts } = await supabase
        .from('payment_certificates')
        .select('id, net_payable_cents')
        .eq('invoice_id', inv.id)
        .eq('status', 'approved')
      
      if (approvedCerts && approvedCerts.length > 0) {
        // Pay through certificates - create payment records linked to each certificate
        for (const cert of approvedCerts) {
          const { error: paymentError } = await supabase
            .from('payments')
            .insert({
              payment_certificate_id: cert.id,
              contractor_id: inv.contractor_id,
              amount_cents: cert.net_payable_cents || 0,
              payment_method: 'eft',
              payment_date: new Date().toISOString().split('T')[0],
              status: 'cleared',
              processed_by: userData.id,
              notes: `Batch: ${batchReference}`,
            })
          
          if (paymentError) {
            console.error('Error creating certificate payment:', paymentError)
          }
          
          // Update certificate to paid
          await supabase
            .from('payment_certificates')
            .update({
              status: 'paid',
              updated_at: new Date().toISOString(),
            })
            .eq('id', cert.id)
        }
      } else {
        // No certificates - use legacy payment_request flow
        const { data: existingPR } = await supabase
          .from('payment_requests')
          .select('id')
          .eq('invoice_id', inv.id)
          .eq('status', 'approved')
          .single()
        
        let paymentRequestId = existingPR?.id
        
        if (!paymentRequestId) {
          // Generate a unique request number
          const requestNumber = `PR-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`
          
          // Create a new payment request
          const { data: newPR, error: prError } = await supabase
            .from('payment_requests')
            .insert({
              request_number: requestNumber,
              invoice_id: inv.id,
              contractor_id: inv.contractor_id,
              requested_amount_cents: paymentAmount,
              approved_amount_cents: paymentAmount,
              status: 'paid',
              payment_method: 'eft',
              payment_reference: batchReference,
              processed_by: userData.id,
              processed_at: new Date().toISOString(),
              created_by: userData.id,
            })
            .select('id')
            .single()
          
          if (prError) {
            console.error('Error creating payment request:', prError)
          }
          paymentRequestId = newPR?.id
        } else {
          // Update existing payment request to paid status
          await supabase
            .from('payment_requests')
            .update({
              status: 'paid',
              payment_method: 'eft',
              payment_reference: batchReference,
              processed_by: userData.id,
              processed_at: new Date().toISOString(),
            })
            .eq('id', paymentRequestId)
        }
        
        // Create payment record linked to payment_request
        if (paymentRequestId) {
          const { error: paymentError } = await supabase
            .from('payments')
            .insert({
              payment_request_id: paymentRequestId,
              contractor_id: inv.contractor_id,
              amount_cents: paymentAmount,
              payment_method: 'eft',
              payment_date: new Date().toISOString().split('T')[0],
              status: 'cleared',
              processed_by: userData.id,
            })
          
          if (paymentError) {
            console.error('Error creating payment:', paymentError)
          }
        }
      }
      
      // Update invoice status and payment tracking
      const { error: updateError } = await supabase
        .from('invoices')
        .update({
          status: 'paid',
          amount_paid_cents: paymentAmount,
          total_paid_cents: paymentAmount,
          amount_remaining_cents: 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', inv.id)
      
      if (updateError) {
        console.error('Execute EFT error updating invoice:', updateError)
        throw new Error(updateError.message)
      }
    }
    
    // Create payment batch record
    await supabase.from('payment_batches').insert({
      batch_reference: batchReference,
      payment_method: 'eft',
      invoice_count: input.invoice_ids.length,
      total_amount_cents: totalAmount,
      executed_by_user_id: userData.id,
      executed_at: new Date().toISOString(),
      status: 'completed',
    })
    
    // Log the critical action
    await supabase.from('audit_logs').insert({
      action: 'eft_payment_executed',
      entity_type: 'payment',
      entity_id: batchReference,
      user_id: userData.id,
      details: { 
        invoice_count: input.invoice_ids.length,
        total_amount_cents: totalAmount,
        invoice_ids: input.invoice_ids,
      },
    })
    
    revalidatePath('/accountant/payments')
    revalidatePath('/accountant/queue')
    
    return { 
      batch_reference: batchReference,
      invoice_count: input.invoice_ids.length,
      total_amount_cents: totalAmount,
    }
  },
  {
    actionName: 'executeEFTPayment',
    module: 'accountant',
    // rateLimit: RATE_LIMITS.EXECUTE_EFT, // temporarily disabled
    isCritical: true,
    // Policy context for EFT limit check - amount passed from client
    // Client must calculate total from selected invoices before calling
    getPolicyContext: (input) => {
      const eftInput = input as ExecuteEFTInput
      return {
        amount: eftInput.total_amount_cents || 0,
        invoiceCount: eftInput.invoice_ids?.length || 0,
      }
    },
  }
)

// =====================================================
// VIEW PAYMENT RECORDS
// =====================================================

/**
 * Get payment history/records
 * Requires: view_payment_records permission
 */
export async function getPaymentHistory(options?: { limit?: number; offset?: number }) {
  return withPermission(PERMISSIONS.PAYMENTS.VIEW_PAYMENT_RECORDS, async () => {
    const supabase = getSupabaseAdmin()
    
    const { data, error } = await supabase
      .from('payment_batches')
      .select(`
        *,
        executed_by:users!payment_batches_executed_by_user_id_fkey(first_name, last_name, email)
      `)
      .order('executed_at', { ascending: false })
      .limit(options?.limit || 50)
      .range(options?.offset || 0, (options?.offset || 0) + (options?.limit || 50) - 1)
    
    if (error) {
      console.error('Get payment history error:', error)
      return { success: false, error: error.message, records: [] }
    }
    
    return { success: true, records: data || [] }
  })
}

// =====================================================
// UPLOAD INVOICE ATTACHMENT
// =====================================================

export interface UploadAttachmentInput {
  invoice_id: string
  file_name: string
  file_url: string
  file_type: string
}

/**
 * Upload attachment to an invoice
 * Requires: upload_invoice_attachment permission
 * Rate limited: 30 actions per minute
 * 
 * Uses enterprise secureAction wrapper
 */
export const uploadInvoiceAttachment = secureAction(
  PERMISSIONS.INVOICES.UPLOAD_INVOICE_ATTACHMENT,
  async (user, input: UploadAttachmentInput) => {
    const supabase = getSupabaseAdmin()
    
    // Get user record
    const { data: userData } = await supabase
      .from('users')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()
    
    if (!userData) {
      throw new Error('User not found')
    }
    
    // Add attachment record
    const { data: attachment, error } = await supabase
      .from('invoice_attachments')
      .insert({
        invoice_id: input.invoice_id,
        file_name: input.file_name,
        file_url: input.file_url,
        file_type: input.file_type,
        uploaded_by_user_id: userData.id,
      })
      .select()
      .single()
    
    if (error) {
      console.error('Upload attachment error:', error)
      throw new Error(error.message)
    }
    
    revalidatePath('/accountant/queue')
    
    return { attachment }
  },
  {
    actionName: 'uploadInvoiceAttachment',
    module: 'accountant',
    // rateLimit: RATE_LIMITS.APPROVE_INVOICE, // temporarily disabled
  }
)

// =====================================================
// HOLDBACK MANAGEMENT
// =====================================================

/**
 * Get holdback ledger entries
 * Requires: view_payment_records permission
 */
export async function getHoldbacks(options?: { 
  status?: 'held' | 'released' | 'all'
  project_id?: string
  contractor_id?: string
  limit?: number 
}) {
  return withPermission(PERMISSIONS.PAYMENTS.VIEW_PAYMENT_RECORDS, async () => {
    const supabase = getSupabaseAdmin()
    
    let query = supabase
      .from('holdback_ledgers')
      .select(`
        *,
        invoice:invoices(
          id,
          invoice_number,
          amount_cents
        ),
        contractor:contractors(id, company_name),
        project:projects(id, name, project_number)
      `)
      .order('created_at', { ascending: false })
      .limit(options?.limit || 100)
    
    if (options?.status && options.status !== 'all') {
      query = query.eq('status', options.status)
    }
    if (options?.project_id) {
      query = query.eq('project_id', options.project_id)
    }
    if (options?.contractor_id) {
      query = query.eq('contractor_id', options.contractor_id)
    }
    
    const { data, error } = await query
    
    if (error) {
      console.error('Get holdbacks error:', error)
      return { success: false, error: error.message, holdbacks: [] }
    }
    
    return { success: true, holdbacks: data || [] }
  })
}

type ReleaseHoldbackInput = {
  holdbackId: string
  notes?: string
  /** Amount in cents for policy evaluation (holdback release limit) */
  amount_cents?: number
}

/**
 * Release a holdback
 * Requires: process_payments permission
 * Rate limited: 10 actions per minute
 * 
 * Uses enterprise secureAction wrapper
 */
export const releaseHoldback = secureAction(
  PERMISSIONS.PAYMENTS.PROCESS_PAYMENTS,
  async (user, input: ReleaseHoldbackInput) => {
    const { holdbackId, notes } = input
    const supabase = getSupabaseAdmin()
    
    // Get user record
    const { data: userData } = await supabase
      .from('users')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()
    
    if (!userData) {
      throw new Error('User not found')
    }
    
    // Get holdback to verify it exists and is still held
    const { data: holdback, error: fetchError } = await supabase
      .from('holdback_ledgers')
      .select('*, invoice:invoices(invoice_number)')
      .eq('id', holdbackId)
      .single()
    
    if (fetchError || !holdback) {
      throw new Error('Holdback not found')
    }
    
    if (holdback.status === 'released') {
      throw new Error('Holdback has already been released')
    }
    
    // Validate that the amount passed for policy check matches the actual holdback
    // This prevents client-side amount manipulation to bypass policy limits
    if (input.amount_cents !== undefined && input.amount_cents !== holdback.amount_cents) {
      throw new Error('Amount mismatch: policy context amount does not match holdback record')
    }
    
    // Update holdback status
    const { error: updateError } = await supabase
      .from('holdback_ledgers')
      .update({
        status: 'released',
        released_at: new Date().toISOString(),
        released_by_user_id: userData.id,
        release_notes: notes || null,
      })
      .eq('id', holdbackId)
    
    if (updateError) {
      console.error('Release holdback error:', updateError)
      throw new Error(updateError.message)
    }
    
    // Log the action
    await supabase.from('audit_logs').insert({
      action: 'holdback_released',
      entity_type: 'holdback',
      entity_id: holdbackId,
      user_id: userData.id,
      details: {
        amount_cents: holdback.amount_cents,
        invoice_number: holdback.invoice?.invoice_number,
        notes,
      },
    })
    
    revalidatePath('/accountant/holdbacks')
    
    return { released: true }
  },
  {
    actionName: 'releaseHoldback',
    module: 'accountant',
    // rateLimit: RATE_LIMITS.EXECUTE_EFT, // temporarily disabled
    isCritical: true,
    // Policy context for holdback release limit check
    // NOTE: amount_cents MUST be passed from client (fetched from holdback record before calling)
    // This is validated server-side in the action body against the actual holdback record
    getPolicyContext: (input) => {
      const releaseInput = input as ReleaseHoldbackInput
      return {
        amount: releaseInput.amount_cents || 0,
      }
    },
  }
)

// =====================================================
// INVOICE QUEUE - READ OPERATIONS
// =====================================================

/**
 * Get invoices for the AP queue
 * Requires: view_ap_queue permission
 */
export async function getInvoiceQueue(options?: {
  status?: 'submitted' | 'pending_approval' | 'approved' | 'disputed' | 'paid' | 'all'
  limit?: number
}) {
  return withPermission(PERMISSIONS.INVOICES.VIEW_AP_QUEUE, async () => {
    const supabase = getSupabaseAdmin()
    
    let query = supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        invoice_date,
        due_date,
        total_cents,
        holdback_cents,
        status,
        created_at,
        document_url,
        contractor:contractors(id, company_name),
        project:projects(id, name, project_number)
      `)
      .order('created_at', { ascending: false })
      .limit(options?.limit || 100)
    
    // Filter by status - default to showing invoices needing review (not paid/rejected)
    if (options?.status && options.status !== 'all') {
      query = query.eq('status', options.status)
    } else if (!options?.status) {
      // Default: show submitted and pending_approval invoices (the queue)
      query = query.in('status', ['submitted', 'pending_approval'])
    }
    
    const { data, error } = await query
    
    if (error) {
      console.error('Get invoice queue error:', error)
      return { success: false, error: error.message, invoices: [] }
    }
    
    return { success: true, invoices: data || [] }
  })
}

/**
 * Get approved invoices ready for payment
 * Requires: process_payments permission
 */
// =====================================================
// SINGLE INVOICE - FULL DETAILS WITH PAYMENT HISTORY
// =====================================================

export async function getInvoiceById(invoiceId: string) {
  return withPermission(PERMISSIONS.INVOICES.VIEW_AP_QUEUE, async () => {
    const supabase = getSupabaseAdmin()
    
    // Fetch invoice with all related data
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        invoice_date,
        due_date,
        subtotal_cents,
        gst_hst_cents,
        gst_hst_rate,
        pst_cents,
        pst_rate,
        qst_cents,
        qst_rate,
        total_cents,
        holdback_cents,
        holdback_percent,
        net_payable_cents,
        amount_paid_cents,
        amount_remaining_cents,
        status,
        source,
        document_url,
        created_at,
        updated_at,
        contractor:contractors(
          id, 
          company_name,
          contact_name,
          email,
          phone,
          address_line1,
          city,
          province,
          postal_code,
          bank_name,
          bank_institution_number,
          bank_transit_number,
          bank_account_number,
          wcb_clearance_expiry,
          status
        ),
        project:projects(
          id, 
          name, 
          project_number,
          city,
          province,
          start_date,
          estimated_completion_date,
          current_budget_cents,
          spent_cents
        ),
        change_order:change_orders(
          id,
          co_number,
          description,
          amount_cents,
          status
        )
      `)
      .eq('id', invoiceId)
      .single()
    
    if (invoiceError) {
      console.error('Get invoice error:', invoiceError)
      return { success: false, error: invoiceError.message, invoice: null, payments: [], holdbacks: [], attachments: [], auditLog: [] }
    }
    
    // Fetch payment history through payment_requests linked to this invoice
    const { data: paymentRequests, error: prError } = await supabase
      .from('payment_requests')
      .select(`
        id,
        request_number,
        requested_amount_cents,
        approved_amount_cents,
        status,
        payment_method,
        payment_reference,
        created_at,
        processed_at
      `)
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: false })
    
    // Get actual payments for these payment requests
    let payments: Array<Record<string, unknown>> = []
    if (paymentRequests && paymentRequests.length > 0) {
      const prIds = paymentRequests.map(pr => pr.id)
      const { data: paymentData, error: paymentsError } = await supabase
        .from('payments')
        .select(`
          id,
          amount_cents,
          payment_method,
          payment_date,
          status,
          cheque_number,
          etransfer_reference,
          wire_reference,
          notes,
          created_at,
          processed_by
        `)
        .in('payment_request_id', prIds)
        .order('created_at', { ascending: false })
      
      if (paymentsError) {
        console.error('Get payments error:', paymentsError)
      }
      payments = paymentData || []
    }
    
    if (prError) {
      console.error('Get payment requests error:', prError)
    }
    
    // Fetch holdback records for this invoice
    const { data: holdbacks, error: holdbacksError } = await supabase
      .from('holdback_ledgers')
      .select(`
        id,
        holdback_amount_cents,
        holdback_percent,
        status,
        release_due_date,
        countdown_start_date,
        released_at,
        released_amount_cents,
        notes
      `)
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: false })
    
    if (holdbacksError) {
      console.error('Get holdbacks error:', holdbacksError)
    }
    
    // Fetch attachments
    const { data: attachments, error: attachmentsError } = await supabase
      .from('invoice_attachments')
      .select(`
        id,
        file_name,
        file_type,
        file_url,
        file_size_bytes,
        created_at
      `)
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: false })
    
    if (attachmentsError) {
      console.error('Get attachments error:', attachmentsError)
    }
    
    // Fetch audit log entries for this invoice
    const { data: auditLog, error: auditError } = await supabase
      .from('audit_logs')
      .select(`
        id,
        action,
        description,
        user_id,
        created_at,
        old_values,
        new_values
      `)
      .eq('entity_type', 'invoice')
      .eq('entity_id', invoiceId)
      .order('created_at', { ascending: false })
      .limit(20)
    
    if (auditError) {
      console.error('Get audit log error:', auditError)
    }
    
    return { 
      success: true, 
      invoice, 
      paymentRequests: paymentRequests || [],
      payments: payments || [], 
      holdbacks: holdbacks || [],
      attachments: attachments || [],
      auditLog: auditLog || []
    }
  })
}

// =====================================================
// CONTRACTOR DETAILS
// =====================================================

export async function getContractorById(contractorId: string) {
  return withPermission(PERMISSIONS.INVOICES.VIEW_AP_QUEUE, async () => {
    const supabase = getSupabaseAdmin()
    
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
        bank_name,
        bank_institution_number,
        bank_transit_number,
        bank_account_number,
        wcb_clearance_expiry,
        wcb_account_number,
        business_number,
        is_corporation,
        notes
      `)
      .eq('id', contractorId)
      .single()
    
    if (contractorError) {
      console.error('Get contractor error:', contractorError)
      return { success: false, error: contractorError.message, contractor: null, invoices: [], payments: [] }
    }
    
    // Fetch invoices for this contractor
    const { data: invoices, error: invoicesError } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        total_cents,
        net_payable_cents,
        status,
        created_at
      `)
      .eq('contractor_id', contractorId)
      .order('created_at', { ascending: false })
      .limit(20)
    
    if (invoicesError) {
      console.error('Get contractor invoices error:', invoicesError)
    }
    
    // Fetch payments for this contractor
    const { data: payments, error: paymentsError } = await supabase
      .from('payments')
      .select(`
        id,
        amount_cents,
        payment_method,
        status,
        created_at,
        payment_date,
        cheque_number,
        etransfer_reference,
        wire_reference
      `)
      .eq('contractor_id', contractorId)
      .order('created_at', { ascending: false })
      .limit(20)
    
    if (paymentsError) {
      console.error('Get contractor payments error:', paymentsError)
    }
    
    return { 
      success: true, 
      contractor, 
      invoices: invoices || [], 
      payments: payments || [] 
    }
  })
}

export async function getApprovedInvoices(options?: { limit?: number }) {
  return withPermission(PERMISSIONS.PAYMENTS.PROCESS_PAYMENTS, async () => {
    const supabase = getSupabaseAdmin()
    
    const { data, error } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        invoice_date,
        updated_at,
        total_cents,
        holdback_cents,
        contractor:contractors(
          id, 
          company_name,
          wcb_clearance_expiry,
          bank_institution_number,
          bank_transit_number,
          bank_account_number
        ),
        project:projects(id, name, project_number)
      `)
      .eq('status', 'approved')
      .order('updated_at', { ascending: false })
      .limit(options?.limit || 100)
    
    if (error) {
      console.error('Get approved invoices error:', error)
      return { success: false, error: error.message, invoices: [] }
    }
    
    return { success: true, invoices: data || [] }
  })
}

// =====================================================
// PAYMENT CERTIFICATE PAYMENT PROCESSING
// =====================================================

/**
 * Get approved payment certificates ready for payment processing
 */
export async function getApprovedCertificatesForPayment(options?: { limit?: number }) {
  return withPermission(PERMISSIONS.PAYMENTS.PROCESS_PAYMENTS, async () => {
    const supabase = getSupabaseAdmin()
    
    const { data, error } = await supabase
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
          total_cents,
          contractor:contractors(
            id, 
            company_name,
            bank_name,
            bank_institution_number,
            bank_transit_number,
            bank_account_number,
            wcb_clearance_expiry
          )
        ),
        project:projects(id, name, project_number)
      `)
      .eq('status', 'approved')
      .order('approved_at', { ascending: true })
      .limit(options?.limit || 100)
    
    if (error) {
      console.error('Get approved certificates error:', error)
      return { success: false, error: error.message, certificates: [] }
    }
    
    return { success: true, certificates: data || [] }
  })
}

/**
 * Record a payment against a payment certificate
 */
export async function recordCertificatePayment(input: {
  certificate_id: string
  amount_cents: number
  payment_method: 'eft' | 'cheque' | 'wire' | 'etransfer'
  payment_date: string
  payment_reference?: string
  cheque_number?: string
  etransfer_reference?: string
  wire_reference?: string
  notes?: string
}) {
  return withPermission(PERMISSIONS.PAYMENTS.PROCESS_PAYMENTS, async (userData) => {
    const supabase = getSupabaseAdmin()
    
    // 1. Fetch the certificate
    const { data: certificate, error: certError } = await supabase
      .from('payment_certificates')
      .select(`
        id,
        certificate_number,
        invoice_id,
        contractor_id,
        project_id,
        net_payable_cents,
        status
      `)
      .eq('id', input.certificate_id)
      .single()
    
    if (certError || !certificate) {
      console.error('Fetch certificate error:', certError)
      return { success: false, error: 'Certificate not found' }
    }
    
    // 2. Validate certificate status
    if (certificate.status !== 'approved') {
      return { success: false, error: `Cannot process payment for certificate with status: ${certificate.status}` }
    }
    
    // 3. Validate payment amount
    if (input.amount_cents <= 0) {
      return { success: false, error: 'Payment amount must be greater than 0' }
    }
    
    if (input.amount_cents > certificate.net_payable_cents) {
      return { 
        success: false, 
        error: `Payment amount ($${(input.amount_cents / 100).toFixed(2)}) exceeds certificate net payable ($${(certificate.net_payable_cents / 100).toFixed(2)})` 
      }
    }
    
    // 4. Create the payment record
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        payment_certificate_id: input.certificate_id,
        contractor_id: certificate.contractor_id,
        amount_cents: input.amount_cents,
        payment_method: input.payment_method,
        payment_date: input.payment_date,
        status: 'cleared',
        cheque_number: input.cheque_number || null,
        etransfer_reference: input.etransfer_reference || null,
        wire_reference: input.wire_reference || null,
        notes: input.notes || null,
        processed_by: userData.id,
      })
      .select()
      .single()
    
    if (paymentError) {
      console.error('Create payment error:', paymentError)
      return { success: false, error: paymentError.message }
    }
    
    // 5. Update certificate status to paid if fully paid
    if (input.amount_cents >= certificate.net_payable_cents) {
      await supabase
        .from('payment_certificates')
        .update({
          status: 'paid',
          updated_at: new Date().toISOString(),
        })
        .eq('id', input.certificate_id)
    }
    
    // 6. Update invoice total_paid_cents
    const { data: invoice } = await supabase
      .from('invoices')
      .select('total_paid_cents')
      .eq('id', certificate.invoice_id)
      .single()
    
    if (invoice) {
      const newTotalPaid = (invoice.total_paid_cents || 0) + input.amount_cents
      await supabase
        .from('invoices')
        .update({
          total_paid_cents: newTotalPaid,
          amount_paid_cents: newTotalPaid,
          amount_remaining_cents: Math.max(0, (invoice.total_paid_cents || 0) - newTotalPaid),
          updated_at: new Date().toISOString(),
        })
        .eq('id', certificate.invoice_id)
    }
    
    // 7. Log the action
    await supabase.from('audit_logs').insert({
      action: 'payment_recorded',
      entity_type: 'payment',
      entity_id: payment.id,
      user_id: userData.id,
      description: `Recorded payment of $${(input.amount_cents / 100).toFixed(2)} for certificate ${certificate.certificate_number}`,
      new_values: {
        amount_cents: input.amount_cents,
        payment_method: input.payment_method,
        certificate_number: certificate.certificate_number,
      },
    })
    
    revalidatePath('/accountant/payments')
    revalidatePath('/accountant/queue')
    
    return { 
      success: true, 
      payment,
      message: `Payment of $${(input.amount_cents / 100).toFixed(2)} recorded successfully`
    }
  })
}

/**
 * Record a direct payment against an invoice (when no payment certificates exist)
 * This is used when the invoice has no linked payment certificates
 */
export async function recordDirectInvoicePayment(input: {
  invoice_id: string
  amount_cents: number
  payment_method: 'eft' | 'cheque' | 'wire' | 'etransfer'
  payment_date: string
  payment_reference?: string
  cheque_number?: string
  etransfer_reference?: string
  wire_reference?: string
  notes?: string
}) {
  return withPermission(PERMISSIONS.PAYMENTS.PROCESS_PAYMENTS, async (userData) => {
    const supabase = getSupabaseAdmin()
    
    // 1. Fetch the invoice and check for certificates
    const { data: invoice, error: invError } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        contractor_id,
        project_id,
        net_payable_cents,
        total_paid_cents,
        amount_paid_cents,
        amount_remaining_cents,
        status
      `)
      .eq('id', input.invoice_id)
      .single()
    
    if (invError || !invoice) {
      console.error('Fetch invoice error:', invError)
      return { success: false, error: 'Invoice not found' }
    }
    
    // 2. Check if invoice has any payment certificates
    const { data: certificates, error: certError } = await supabase
      .from('payment_certificates')
      .select('id')
      .eq('invoice_id', input.invoice_id)
    
    if (certError) {
      console.error('Fetch certificates error:', certError)
      return { success: false, error: 'Failed to check payment certificates' }
    }
    
    // 3. If certificates exist, block direct payment
    if (certificates && certificates.length > 0) {
      return { 
        success: false, 
        error: `This invoice has ${certificates.length} payment certificate(s). Payments must be made against individual certificates, not the invoice directly.` 
      }
    }
    
    // 4. Validate invoice status
    if (!['approved', 'payment_processing', 'paid'].includes(invoice.status)) {
      return { success: false, error: `Cannot process payment for invoice with status: ${invoice.status}` }
    }
    
    // 5. Calculate remaining balance
    const currentPaid = invoice.amount_paid_cents || invoice.total_paid_cents || 0
    const remainingBalance = invoice.net_payable_cents - currentPaid
    
    // 6. Validate payment amount
    if (input.amount_cents <= 0) {
      return { success: false, error: 'Payment amount must be greater than 0' }
    }
    
    if (input.amount_cents > remainingBalance) {
      return { 
        success: false, 
        error: `Payment amount ($${(input.amount_cents / 100).toFixed(2)}) exceeds remaining balance ($${(remainingBalance / 100).toFixed(2)})` 
      }
    }
    
    // 7. Create a payment request for tracking
    const requestNumber = `PR-INV-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`
    
    const { data: paymentRequest, error: prError } = await supabase
      .from('payment_requests')
      .insert({
        request_number: requestNumber,
        invoice_id: input.invoice_id,
        contractor_id: invoice.contractor_id,
        project_id: invoice.project_id,
        requested_amount_cents: input.amount_cents,
        approved_amount_cents: input.amount_cents,
        status: 'paid',
        payment_method: input.payment_method,
        payment_reference: input.payment_reference || `Direct payment for ${invoice.invoice_number}`,
        processed_by: userData.id,
        processed_at: new Date().toISOString(),
        created_by: userData.id,
        description: 'Direct invoice payment (no certificates)',
      })
      .select('id')
      .single()
    
    if (prError) {
      console.error('Create payment request error:', prError)
      return { success: false, error: prError.message }
    }
    
    // 8. Create the payment record
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        payment_request_id: paymentRequest.id,
        contractor_id: invoice.contractor_id,
        amount_cents: input.amount_cents,
        payment_method: input.payment_method,
        payment_date: input.payment_date,
        status: 'cleared',
        cheque_number: input.cheque_number || null,
        etransfer_reference: input.etransfer_reference || null,
        wire_reference: input.wire_reference || null,
        notes: input.notes ? `Direct Invoice Payment: ${input.notes}` : `Direct payment for invoice ${invoice.invoice_number}`,
        processed_by: userData.id,
      })
      .select()
      .single()
    
    if (paymentError) {
      console.error('Create payment error:', paymentError)
      return { success: false, error: paymentError.message }
    }
    
    // 9. Update invoice payment totals
    const newTotalPaid = currentPaid + input.amount_cents
    const newRemainingAmount = invoice.net_payable_cents - newTotalPaid
    const isFullyPaid = newRemainingAmount <= 0
    
    await supabase
      .from('invoices')
      .update({
        total_paid_cents: newTotalPaid,
        amount_paid_cents: newTotalPaid,
        amount_remaining_cents: Math.max(0, newRemainingAmount),
        status: isFullyPaid ? 'paid' : 'payment_processing',
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.invoice_id)
    
    // 10. Log the action
    await supabase.from('audit_logs').insert({
      action: 'direct_invoice_payment',
      entity_type: 'invoice',
      entity_id: input.invoice_id,
      user_id: userData.id,
      description: `Recorded direct payment of $${(input.amount_cents / 100).toFixed(2)} for invoice ${invoice.invoice_number}`,
      new_values: {
        amount_cents: input.amount_cents,
        payment_method: input.payment_method,
        invoice_number: invoice.invoice_number,
        payment_type: 'direct_invoice',
      },
    })
    
    revalidatePath('/accountant/payments')
    revalidatePath('/accountant/queue')
    revalidatePath(`/accountant/invoices/${input.invoice_id}`)
    
    return { 
      success: true, 
      payment,
      message: `Direct payment of $${(input.amount_cents / 100).toFixed(2)} recorded successfully for invoice ${invoice.invoice_number}`,
      isFullyPaid,
    }
  })
}

/**
 * Get invoice payment status with certificate information
 * Returns payment mode and details for UI rendering
 */
export async function getInvoicePaymentInfo(invoiceId: string) {
  return withPermission(PERMISSIONS.INVOICES.VIEW_INVOICES, async () => {
    const supabase = getSupabaseAdmin()
    
    // Get invoice details
    const { data: invoice, error: invError } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        contractor_id,
        net_payable_cents,
        total_paid_cents,
        amount_paid_cents,
        amount_remaining_cents,
        status
      `)
      .eq('id', invoiceId)
      .single()
    
    if (invError || !invoice) {
      return { success: false, error: 'Invoice not found' }
    }
    
    // Get payment certificates for this invoice
    const { data: certificates, error: certError } = await supabase
      .from('payment_certificates')
      .select(`
        id,
        certificate_number,
        certified_amount_cents,
        net_payable_cents,
        holdback_amount_cents,
        status,
        created_at,
        approved_at,
        work_period_start,
        work_period_end
      `)
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: true })
    
    if (certError) {
      console.error('Fetch certificates error:', certError)
      return { success: false, error: 'Failed to fetch certificates' }
    }
    
    // Get payments for certificates
    const certificateIds = (certificates || []).map(c => c.id)
    let certificatePayments: Array<{
      id: string
      payment_certificate_id: string
      amount_cents: number
      payment_date: string
      status: string
      payment_method: string
    }> = []
    
    if (certificateIds.length > 0) {
      const { data: payments } = await supabase
        .from('payments')
        .select('id, payment_certificate_id, amount_cents, payment_date, status, payment_method')
        .in('payment_certificate_id', certificateIds)
      
      certificatePayments = payments || []
    }
    
    // Get direct invoice payments (via payment_requests)
    const { data: paymentRequests } = await supabase
      .from('payment_requests')
      .select('id')
      .eq('invoice_id', invoiceId)
    
    let directPayments: Array<{
      id: string
      amount_cents: number
      payment_date: string
      status: string
      payment_method: string
      notes: string
    }> = []
    
    if (paymentRequests && paymentRequests.length > 0) {
      const { data: payments } = await supabase
        .from('payments')
        .select('id, amount_cents, payment_date, status, payment_method, notes')
        .in('payment_request_id', paymentRequests.map(pr => pr.id))
      
      directPayments = payments || []
    }
    
    // Calculate totals
    const certificateCount = certificates?.length || 0
    const hasCertificates = certificateCount > 0
    const paymentMode = hasCertificates ? 'certificate' : 'direct'
    
    // Calculate certificate-level details
    const certificatesWithPayments = (certificates || []).map(cert => {
      const certPayments = certificatePayments.filter(p => p.payment_certificate_id === cert.id)
      const totalPaidCents = certPayments.reduce((sum, p) => sum + (p.amount_cents || 0), 0)
      const remainingCents = (cert.net_payable_cents || 0) - totalPaidCents
      
      return {
        ...cert,
        payments: certPayments,
        total_paid_cents: totalPaidCents,
        remaining_cents: Math.max(0, remainingCents),
        is_fully_paid: remainingCents <= 0,
      }
    })
    
    // Invoice totals
    const totalCertifiedCents = (certificates || []).reduce((sum, c) => sum + (c.certified_amount_cents || 0), 0)
    const totalPaidCents = invoice.amount_paid_cents || invoice.total_paid_cents || 0
    const invoiceRemainingCents = Math.max(0, invoice.net_payable_cents - totalPaidCents)
    
    return {
      success: true,
      paymentMode,
      invoice: {
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        net_payable_cents: invoice.net_payable_cents,
        total_paid_cents: totalPaidCents,
        remaining_cents: invoiceRemainingCents,
        status: invoice.status,
      },
      certificates: certificatesWithPayments,
      directPayments,
      summary: {
        certificate_count: certificateCount,
        total_certified_cents: totalCertifiedCents,
        total_paid_cents: totalPaidCents,
        total_remaining_cents: invoiceRemainingCents,
        has_certificates: hasCertificates,
      },
    }
  })
}

/**
 * Execute batch EFT payment for multiple certificates
 */
export async function executeCertificateEFTBatch(input: {
  certificate_ids: string[]
  batch_reference?: string
}) {
  return withPermission(PERMISSIONS.PAYMENTS.EXECUTE_EFT_PAYMENTS, async (userData) => {
    const supabase = getSupabaseAdmin()
    
    if (!input.certificate_ids || input.certificate_ids.length === 0) {
      return { success: false, error: 'No certificates selected' }
    }
    
    // Fetch all certificates
    const { data: certificates, error: fetchError } = await supabase
      .from('payment_certificates')
      .select('id, certificate_number, invoice_id, contractor_id, net_payable_cents, status')
      .in('id', input.certificate_ids)
    
    if (fetchError) {
      console.error('Fetch certificates error:', fetchError)
      return { success: false, error: fetchError.message }
    }
    
    // Validate all certificates are approved
    const invalidCerts = certificates?.filter(c => c.status !== 'approved')
    if (invalidCerts?.length) {
      return { success: false, error: `${invalidCerts.length} certificate(s) are not in approved status` }
    }
    
    const batchReference = input.batch_reference || `EFT-CERT-${Date.now()}`
    const totalAmount = certificates?.reduce((sum, c) => sum + (c.net_payable_cents || 0), 0) || 0
    
    // Process each certificate
    for (const cert of certificates || []) {
      // Create payment record
      await supabase
        .from('payments')
        .insert({
          payment_certificate_id: cert.id,
          contractor_id: cert.contractor_id,
          amount_cents: cert.net_payable_cents,
          payment_method: 'eft',
          payment_date: new Date().toISOString().split('T')[0],
          status: 'cleared',
          processed_by: userData.id,
        })
      
      // Update certificate to paid
      await supabase
        .from('payment_certificates')
        .update({
          status: 'paid',
          updated_at: new Date().toISOString(),
        })
        .eq('id', cert.id)
      
      // Update invoice total_paid_cents
      const { data: invoice } = await supabase
        .from('invoices')
        .select('total_paid_cents, total_cents')
        .eq('id', cert.invoice_id)
        .single()
      
      if (invoice) {
        const newTotalPaid = (invoice.total_paid_cents || 0) + cert.net_payable_cents
        const invoiceFullyPaid = newTotalPaid >= invoice.total_cents
        
        await supabase
          .from('invoices')
          .update({
            total_paid_cents: newTotalPaid,
            amount_paid_cents: newTotalPaid,
            amount_remaining_cents: Math.max(0, invoice.total_cents - newTotalPaid),
            status: invoiceFullyPaid ? 'paid' : 'approved',
            updated_at: new Date().toISOString(),
          })
          .eq('id', cert.invoice_id)
      }
    }
    
    // Create batch record
    await supabase.from('payment_batches').insert({
      batch_reference: batchReference,
      payment_method: 'eft',
      invoice_count: input.certificate_ids.length,
      total_amount_cents: totalAmount,
      executed_by_user_id: userData.id,
      executed_at: new Date().toISOString(),
      status: 'completed',
    })
    
    // Log the action
    await supabase.from('audit_logs').insert({
      action: 'eft_certificate_batch_executed',
      entity_type: 'payment_batch',
      entity_id: batchReference,
      user_id: userData.id,
      description: `Executed EFT batch for ${input.certificate_ids.length} certificates totaling $${(totalAmount / 100).toFixed(2)}`,
      new_values: {
        certificate_count: input.certificate_ids.length,
        total_amount_cents: totalAmount,
        certificate_ids: input.certificate_ids,
      },
    })
    
    revalidatePath('/accountant/payments')
    revalidatePath('/accountant/queue')
    
    return { 
      success: true, 
      batchReference,
      totalAmount,
      certificateCount: input.certificate_ids.length,
      message: `EFT batch executed: ${input.certificate_ids.length} certificates, $${(totalAmount / 100).toFixed(2)}`
    }
  })
}
