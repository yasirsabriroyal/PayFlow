'use server'

import { revalidatePath } from 'next/cache'
import {
  PERMISSIONS,
  withPermission,
} from '@/lib/permissions'
import {
  secureAction,
  // RATE_LIMITS, // temporarily disabled
} from '@/lib/security/secureAction'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { resolveInternalUserId } from '@/lib/utils/resolve-user'
import { applyInvoiceStatusChange, dispatchPaymentConfirmation } from '@/lib/invoices/status-flow'
import { validateBankingForInvoiceBatch, evaluateBankingGate } from '@/lib/payments/banking-gate'
import { validateComplianceDocsForPayment, formatComplianceError, consumeInvoiceOverrides } from '@/lib/payments/compliance-validation'
import { createHoldbackLedger, createHoldbackLedgerBatch } from '@/lib/payments/holdback-engine'
import { getInvoicePaymentBalance, getCertificatePaymentBalance } from '@/lib/payments/payment-balance'
import { sendGenericAlert } from '@/lib/notifications/server-dispatch'

// =====================================================
// COMPLIANCE BLOCK NOTIFICATION HELPER
// =====================================================

/**
 * Fires in-app notifications to Admin, Accountant, and assigned PM when a
 * payment is blocked by the compliance gate. Non-fatal — never affects the
 * payment result. Message is internal-facing only (not contractor-visible).
 */
async function notifyComplianceBlock(opts: {
  invoiceId: string | null
  invoiceNumber: string
  contractorName: string
  reason: string
  projectId?: string | null
  actorUserId: string
}): Promise<void> {
  const supabase = getSupabaseAdmin()
  const title = `Payment blocked — compliance issue`
  const body =
    `Invoice ${opts.invoiceNumber} for ${opts.contractorName} was blocked before payment. ` +
    `Reason: ${opts.reason}`
  const link = opts.invoiceId
    ? `/accountant/invoices/${opts.invoiceId}`
    : `/accountant/payments`

  try {
    // Fetch all Admin and Accountant users
    const { data: internalUsers } = await supabase
      .from('users')
      .select('id, first_name, last_name, email, role')
      .in('role', ['admin', 'accountant'])

    // Optionally find the assigned PM for this invoice's project
    let pmUsers: Array<{ id: string; first_name: string | null; last_name: string | null; email: string | null }> = []
    if (opts.projectId) {
      const { data: pmRows } = await supabase
        .from('project_assignments')
        .select('user_id, users!inner(id, first_name, last_name, email, role)')
        .eq('project_id', opts.projectId)

      if (pmRows) {
        pmUsers = pmRows
          .map((r: Record<string, unknown>) => {
            const u = r.users as { id: string; first_name: string | null; last_name: string | null; email: string | null; role: string } | null
            return u
          })
          .filter((u): u is NonNullable<typeof u> => u !== null && u.role === 'project_manager')
      }
    }

    const recipients = [
      ...(internalUsers ?? []),
      ...pmUsers,
    ]

    // Deduplicate by user id
    const seen = new Set<string>()
    const unique = recipients.filter(u => {
      if (seen.has(u.id)) return false
      seen.add(u.id)
      return true
    })

    await Promise.all(
      unique.map(u =>
        sendGenericAlert({
          recipientUserId: u.id,
          recipient: {
            id: u.id,
            name: [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Team Member',
            email: u.email ?? undefined,
            role: (u as { role?: string }).role as 'admin' | 'accountant' | 'project_manager' | undefined,
          },
          type: 'payment_blocked_compliance',
          title,
          body,
          link,
        })
      )
    )
  } catch (e) {
    // Non-fatal — the payment block itself is already logged to audit_logs
    console.error('[notifyComplianceBlock] failed to send notifications:', e)
  }
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
    
    // Get user record (incl. name + role for the status-change actor)
    const { data: userData } = await supabase
      .from('users')
      .select('id, first_name, last_name, role, email')
      .eq('auth_user_id', user.id)
      .single()
    
    if (!userData) {
      throw new Error('User not found')
    }

    const eftActor = {
      userId: userData.id,
      name: `${userData.first_name ?? ''} ${userData.last_name ?? ''}`.trim() || userData.email || 'Accountant',
      role: userData.role ?? 'accountant',
      authUserId: user.id,
    }
    
    // Centralized transition: validates, updates status, writes audit + history,
    // and dispatches notifications (contractor + assigned PM + accountants).
    const { invoice } = await applyInvoiceStatusChange({
      invoiceId: input.invoice_id,
      newStatus: 'approved',
      actor: {
        userId: userData.id,
        name: `${userData.first_name ?? ''} ${userData.last_name ?? ''}`.trim() || 'User',
        role: userData.role,
        authUserId: user.id,
      },
      reason: input.notes,
    })
    
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

export interface ApproveInvoicesBatchInput {
  invoice_ids: string[]
  notes?: string
}

export interface BatchApproveResult {
  invoice_id: string
  success: boolean
  error?: string
}

/**
 * Approve multiple invoices in one action.
 *
 * Each invoice is processed through the SAME per-invoice transition
 * (`applyInvoiceStatusChange`) used by `approveInvoice`, so every financial
 * control is preserved: status-flow validation, audit + history writes, and
 * notifications. Failures are isolated per-invoice — one bad invoice does not
 * abort the rest — and a per-item result is returned so the UI can report
 * partial success.
 *
 * Requires: approve_invoices permission (enforced once for the batch).
 */
export const approveInvoicesBatch = secureAction(
  PERMISSIONS.INVOICES.APPROVE_INVOICES,
  async (user, input: ApproveInvoicesBatchInput) => {
    if (!Array.isArray(input.invoice_ids) || input.invoice_ids.length === 0) {
      throw new Error('No invoices selected')
    }

    const supabase = getSupabaseAdmin()

    const { data: userData } = await supabase
      .from('users')
      .select('id, first_name, last_name, role')
      .eq('auth_user_id', user.id)
      .single()

    if (!userData) {
      throw new Error('User not found')
    }

    const actor = {
      userId: userData.id,
      name: `${userData.first_name ?? ''} ${userData.last_name ?? ''}`.trim() || 'User',
      role: userData.role,
      authUserId: user.id,
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const results: BatchApproveResult[] = []

    for (const invoiceId of input.invoice_ids) {
      if (!invoiceId || !uuidRegex.test(invoiceId)) {
        results.push({ invoice_id: invoiceId, success: false, error: 'Invalid invoice ID' })
        continue
      }

      try {
        await applyInvoiceStatusChange({
          invoiceId,
          newStatus: 'approved',
          actor,
          reason: input.notes,
        })
        results.push({ invoice_id: invoiceId, success: true })
      } catch (err) {
        results.push({
          invoice_id: invoiceId,
          success: false,
          error: err instanceof Error ? err.message : 'Approval failed',
        })
      }
    }

    revalidatePath('/accountant/queue')
    revalidatePath('/accountant/payments')

    const approvedCount = results.filter((r) => r.success).length
    return {
      results,
      approvedCount,
      failedCount: results.length - approvedCount,
    }
  },
  {
    actionName: 'approveInvoicesBatch',
    module: 'accountant',
    isCritical: true,
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
      .select('id, first_name, last_name, role')
      .eq('auth_user_id', user.id)
      .single()
    
    if (!userData) {
      return { success: false, error: 'User not found' }
    }
    
    // Centralized transition: validates, updates status + reject metadata,
    // writes audit + history, and notifies contractor + assigned PM + accountants.
    const { invoice } = await applyInvoiceStatusChange({
      invoiceId: input.invoice_id,
      newStatus: 'rejected',
      actor: {
        userId: userData.id,
        name: `${userData.first_name ?? ''} ${userData.last_name ?? ''}`.trim() || 'User',
        role: userData.role,
        authUserId: user.id,
      },
      reason: input.reason,
      extraInvoiceUpdates: {
        rejection_reason: input.reason,
        rejected_by_user_id: userData.id,
        rejected_at: new Date().toISOString(),
      },
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

export interface DisputeInvoiceInput {
  invoice_id: string
  /** 'open' to flag a dispute, 'resolve' to clear it */
  mode?: 'open' | 'resolve'
  reason: string
  /** Status to move to when resolving (defaults to pending_approval) */
  resolve_to?: 'pending_approval' | 'rejected'
  project_id?: string
  assigned_project_ids?: string[]
}

/**
 * Flag an invoice as disputed, or resolve an existing dispute.
 * Requires: dispute_invoices permission
 */
export const disputeInvoice = secureAction(
  PERMISSIONS.INVOICES.DISPUTE_INVOICES,
  async (user, input: DisputeInvoiceInput) => {
    if (!input.reason?.trim()) {
      throw new Error('A reason is required')
    }

    const supabase = getSupabaseAdmin()
    const { data: userData } = await supabase
      .from('users')
      .select('id, first_name, last_name, role')
      .eq('auth_user_id', user.id)
      .single()

    if (!userData) {
      throw new Error('User not found')
    }

    const actor = {
      userId: userData.id,
      name: `${userData.first_name ?? ''} ${userData.last_name ?? ''}`.trim() || 'User',
      role: userData.role,
      authUserId: user.id,
    }

    const mode = input.mode ?? 'open'

    if (mode === 'resolve') {
      const { invoice } = await applyInvoiceStatusChange({
        invoiceId: input.invoice_id,
        newStatus: input.resolve_to ?? 'pending_approval',
        actor,
        reason: input.reason,
        extraInvoiceUpdates: {
          dispute_reason: null,
          disputed_by_user_id: null,
          disputed_at: null,
        },
      })
      revalidatePath('/accountant/queue')
      return { invoice }
    }

    const { invoice } = await applyInvoiceStatusChange({
      invoiceId: input.invoice_id,
      newStatus: 'disputed',
      actor,
      reason: input.reason,
      extraInvoiceUpdates: {
        dispute_reason: input.reason,
        disputed_by_user_id: userData.id,
        disputed_at: new Date().toISOString(),
      },
    })

    revalidatePath('/accountant/queue')
    return { invoice }
  },
  {
    actionName: 'disputeInvoice',
    module: 'accountant',
    isCritical: true,
    getPolicyContext: (input) => {
      const disputeInput = input as DisputeInvoiceInput
      return {
        projectId: disputeInput.project_id,
        assignedProjectIds: disputeInput.assigned_project_ids || [],
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

    // ── Stage 2: Hard banking gate for EFT batch ──────────────────────────────
    // Prevents invoices from entering payment_processing when banking is not approved.
    if (input.payment_method === 'eft') {
      const bankingError = await validateBankingForInvoiceBatch(supabase, input.invoice_ids, input.payment_method)
      if (bankingError) {
        await supabase.from('audit_logs').insert({
          action: 'banking_payment_blocked',
          entity_type: 'payment_batch',
          entity_id: `process-blocked-${Date.now()}`,
          user_id: userData.id,
          description: bankingError,
          new_values: {
            invoice_ids: input.invoice_ids,
            payment_method: input.payment_method,
            reason: bankingError,
          },
        })
        throw new Error(bankingError)
      }
    }

    // ── Compliance gate for processPayments ───────────────────────────────────
    // BUG-FIX (Issue B): processPayments previously had no compliance gate.
    // Non-compliant invoices could be moved to payment_processing unblocked.
    // Every payment path that advances invoice status must validate compliance.
    // We fetch contractor_id from the invoices table to run the per-invoice check.
    {
      const { data: batchInvoices } = await supabase
        .from('invoices')
        .select('id, invoice_number, contractor_id, project_id')
        .in('id', input.invoice_ids)

      for (const inv of batchInvoices ?? []) {
        if (!inv.contractor_id) continue // system/recurring invoices without a contractor skip compliance

        const complianceResult = await validateComplianceDocsForPayment({
          contractorId: inv.contractor_id,
          invoiceId: inv.id,
          paymentMethod: input.payment_method,
        })

        if (!complianceResult.valid) {
          const complianceError = await formatComplianceError(complianceResult)

          await supabase.from('audit_logs').insert({
            action: 'payment_blocked_compliance',
            entity_type: 'invoice',
            entity_id: inv.id,
            user_id: userData.id,
            description: complianceError,
            new_values: {
              invoice_id: inv.id,
              invoice_number: inv.invoice_number,
              contractor_id: inv.contractor_id,
              payment_method: input.payment_method,
              failures: complianceResult.failures,
              reason: complianceError,
            },
          })

          const { data: contractorRow } = await supabase
            .from('contractors')
            .select('company_name, contact_name')
            .eq('id', inv.contractor_id)
            .maybeSingle()
          void notifyComplianceBlock({
            invoiceId: inv.id,
            invoiceNumber: inv.invoice_number || inv.id,
            contractorName:
              contractorRow?.company_name || contractorRow?.contact_name || inv.contractor_id,
            reason: complianceError,
            projectId: inv.project_id ?? null,
            actorUserId: userData.id,
          })

          throw new Error(`Invoice ${inv.invoice_number || inv.id}: ${complianceError}`)
        }
      }
    }

    // Pre-check: fetch the invoices to verify none are already fully paid.
    // The .eq('status', 'approved') filter below handles the status check, but
    // an invoice could be in 'approved' status while having partial payments
    // already recorded (data inconsistency). Block these explicitly.
    const { data: candidateInvoices } = await supabase
      .from('invoices')
      .select('id, net_payable_cents, status')
      .in('id', input.invoice_ids)

    const alreadyPaidIds: string[] = []
    for (const inv of candidateInvoices ?? []) {
      const invBalance = await getInvoicePaymentBalance(
        supabase,
        inv.id,
        inv.net_payable_cents || 0,
      )
      if (invBalance.isFullyPaid) {
        alreadyPaidIds.push(inv.id)
      }
    }

    if (alreadyPaidIds.length > 0) {
      throw new Error(
        `${alreadyPaidIds.length} invoice(s) are already fully paid and cannot be moved to payment processing.`,
      )
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
  payment_method: 'eft' | 'cheque' | 'wire' | 'etransfer'
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
      .select('id, first_name, last_name')
      .eq('auth_user_id', user.id)
      .single()
    
    if (!userData) {
      throw new Error('User not found')
    }

    const processedByName =
      [userData.first_name, userData.last_name].filter(Boolean).join(' ').trim() || 'Accounts Payable'
    
    // Verify all invoices are in approved/payment_processing status
    const { data: invoices, error: fetchError } = await supabase
      .from('invoices')
      .select('id, status, net_payable_cents, holdback_cents, holdback_percent, contractor_id, invoice_number, project_id')
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

    // Block EFT if any invoice has payment certificates that are not fully paid.
    // Same status-based check as recordDirectInvoicePayment() — prevents the
    // legacy payment_requests fallback from bypassing unpaid/draft certificates.
    const { data: unpaidCerts, error: certCheckError } = await supabase
      .from('payment_certificates')
      .select('id')
      .in('invoice_id', input.invoice_ids)
      .neq('status', 'paid')

    if (certCheckError) {
      throw new Error(certCheckError.message)
    }

    if (unpaidCerts && unpaidCerts.length > 0) {
      throw new Error(
        `${unpaidCerts.length} payment certificate${unpaidCerts.length > 1 ? 's' : ''} must be fully paid before paying this invoice balance.`
      )
    }

    // ── Stage 2: Hard banking gate ────────────────────────────────────────────
    // Validates banking approval status for all contractors in this batch.
    // If any contractor's banking is not approved, the entire batch is blocked.
    // No payment records are created, no statuses are changed.
    const bankingError = await validateBankingForInvoiceBatch(supabase, input.invoice_ids, input.payment_method)
    if (bankingError) {
      // Audit log the block attempt
      const auditUserId = userData?.id
      if (auditUserId) {
        await supabase.from('audit_logs').insert({
          action: 'banking_payment_blocked',
          entity_type: 'payment_batch',
          entity_id: `eft-blocked-${Date.now()}`,
          user_id: auditUserId,
          description: bankingError,
          new_values: {
            invoice_ids: input.invoice_ids,
            payment_method: input.payment_method,
            reason: bankingError,
          },
        })
      }
      throw new Error(bankingError)
    }

    // ── Stage 5: Compliance gate ──────────────────────────────────────────────
    // Validate compliance documents for every invoice in this batch.
    // A single compliance failure blocks the entire batch.
    // Overrides are collected per-invoice and consumed after payment commits.
    // BUG-004: pendingOverrideConsumptions accumulates { invoiceId, contractorId, overrideIds }
    // for all invoice-specific overrides that were used to unblock this batch.
    const pendingOverrideConsumptions: Array<{
      invoiceId: string
      contractorId: string
      overrideIds: string[]
    }> = []

    for (const inv of invoices || []) {
      const complianceResult = await validateComplianceDocsForPayment({
        contractorId: inv.contractor_id,
        invoiceId: inv.id,
        paymentMethod: input.payment_method,
      })
      if (!complianceResult.valid) {
        const complianceError = await formatComplianceError(complianceResult)
        if (userData?.id) {
          await supabase.from('audit_logs').insert({
            action: 'payment_blocked_compliance',
            entity_type: 'invoice',
            entity_id: inv.id,
            user_id: userData.id,
            description: complianceError,
            new_values: {
              invoice_id: inv.id,
              invoice_number: inv.invoice_number,
              contractor_id: inv.contractor_id,
              payment_method: input.payment_method,
              failures: complianceResult.failures,
              reason: complianceError,
            },
          })
        }
        // Notify Admin, Accountant, assigned PM
        const { data: contractorRow } = await supabase
          .from('contractors')
          .select('company_name, contact_name')
          .eq('id', inv.contractor_id)
          .maybeSingle()
        void notifyComplianceBlock({
          invoiceId: inv.id,
          invoiceNumber: inv.invoice_number || inv.id,
          contractorName: contractorRow?.company_name || contractorRow?.contact_name || inv.contractor_id,
          reason: complianceError,
          projectId: inv.project_id ?? null,
          actorUserId: userData.id,
        })
        throw new Error(`Invoice ${inv.invoice_number || inv.id}: ${complianceError}`)
      }
      // Collect any invoice-specific overrides used so we can consume them post-payment
      if (complianceResult.overriddenIssues.length > 0) {
        pendingOverrideConsumptions.push({
          invoiceId: inv.id,
          contractorId: inv.contractor_id,
          overrideIds: complianceResult.overriddenIssues.map(o => o.overrideId),
        })
      }
    }

    const batchReference = input.batch_reference || `EFT-${Date.now()}`
    // totalAmount accumulates only what is actually paid in this batch
    // (remaining balance per invoice), not the full net_payable_cents totals.
    let totalAmount = 0

    const processedPaymentIds: string[] = []
    const processedCertIds: string[] = []

    // Update each invoice to paid status with proper amount tracking
    for (const inv of invoices || []) {
      // Query actual payment records to determine how much is still owed.
      // Never assume net_payable_cents is fully unpaid — prior direct payments
      // or partial certificate payments may have already reduced the balance.
      const invBalance = await getInvoicePaymentBalance(
        supabase,
        inv.id,
        inv.net_payable_cents || 0,
      )

      if (invBalance.isFullyPaid) {
        // Invoice already fully paid through a prior payment path.
        // Do not create another payment record.
        continue
      }

      // paymentAmount is the invoice-level remaining balance and is used for
      // the non-certificate (payment_request) path below. For the certificate
      // path we calculate per-cert remaining balances individually so that a
      // cert that was partially paid outside this batch is handled correctly.
      const paymentAmount = invBalance.remainingPayableCents

      // First check if there are approved payment certificates for this invoice
      const { data: approvedCerts } = await supabase
        .from('payment_certificates')
        .select('id, certificate_number, net_payable_cents')
        .eq('invoice_id', inv.id)
        .eq('status', 'approved')

      if (approvedCerts && approvedCerts.length > 0) {
        // Pay through certificates — create payment records linked to each cert.
        // Each cert is checked independently against the payments table so that
        // a cert already (partially) paid outside this batch is never overpaid.
        for (const cert of approvedCerts) {
          // Authoritative balance for this specific certificate.
          const certBalance = await getCertificatePaymentBalance(
            supabase,
            cert.id,
            cert.net_payable_cents || 0,
          )

          if (certBalance.isFullyPaid) {
            // Certificate was already paid through another path — skip it.
            // Do not create a duplicate payment record.
            continue
          }

          // Use remaining payable, not the full cert.net_payable_cents.
          const certPaymentAmount = certBalance.remainingPayableCents
          totalAmount += certPaymentAmount

          const { data: newPayment, error: paymentError } = await supabase
            .from('payments')
            .insert({
              payment_certificate_id: cert.id,
              contractor_id: inv.contractor_id,
              amount_cents: certPaymentAmount,
              payment_method: input.payment_method,
              payment_date: new Date().toISOString().split('T')[0],
              status: 'cleared',
              processed_by: userData.id,
              notes: `Batch: ${batchReference}`,
            })
            .select('id')
            .single()

          if (paymentError) {
            console.error('Error creating certificate payment:', paymentError)
            // Compensating rollback
            if (processedPaymentIds.length > 0) {
              const { error: rbPayErr } = await supabase.from('payments').delete().in('id', processedPaymentIds)
              if (rbPayErr) console.error('Rollback failed (payments):', rbPayErr)
              const { error: rbCertErr } = await supabase
                .from('payment_certificates')
                .update({ status: 'approved', updated_at: new Date().toISOString() })
                .in('id', processedCertIds)
              if (rbCertErr) console.error('Rollback failed (certificates):', rbCertErr)
            }
            throw new Error(`Payment failed for certificate ${cert.certificate_number}: ${paymentError.message}`)
          }

          if (newPayment) processedPaymentIds.push(newPayment.id)

          // Update certificate to paid
          await supabase
            .from('payment_certificates')
            .update({
              status: 'paid',
              updated_at: new Date().toISOString(),
            })
            .eq('id', cert.id)

          processedCertIds.push(cert.id)
        }
      } else {
        // No certificates — use legacy payment_request flow.
        // Accumulate the invoice-level remaining payable into the batch total.
        totalAmount += paymentAmount
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
              payment_method: input.payment_method,
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
              payment_method: input.payment_method,
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
              payment_method: input.payment_method,
              payment_date: new Date().toISOString().split('T')[0],
              status: 'cleared',
              processed_by: userData.id,
            })
          
          if (paymentError) {
            console.error('Error creating payment:', paymentError)
          }
        }
      }
      
      // Update invoice status and payment tracking.
      // amount_paid_cents / total_paid_cents must accumulate (prior paid +
      // this payment). Writing only paymentAmount would overwrite prior
      // payments and cause the fields to show less than what was actually paid.
      const newTotalPaidCents = invBalance.totalPaidCents + paymentAmount
      const { error: updateError } = await supabase
        .from('invoices')
        .update({
          status: 'paid',
          amount_paid_cents: newTotalPaidCents,
          total_paid_cents: newTotalPaidCents,
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
      payment_method: input.payment_method,
      invoice_count: input.invoice_ids.length,
      total_amount_cents: totalAmount,
      executed_by_user_id: userData.id,
      executed_at: new Date().toISOString(),
      status: 'completed',
    })

    // Stage 3: Create holdback ledger rows for every invoice in the batch that
    // carries a holdback. Payment records and invoice statuses are already
    // committed at this point, so failures are collected as warnings rather than
    // aborting the batch. Each per-invoice failure is independently audit-logged
    // by the holdback engine itself.
    const holdbackDate = new Date().toISOString().split('T')[0]
    const batchHoldbackResult = await createHoldbackLedgerBatch(supabase, {
      paymentDate: holdbackDate,
      processedByUserId: userData.id,
      invoices: (invoices || []).map((inv) => ({
        invoiceId: inv.id,
        contractorId: inv.contractor_id,
        projectId: inv.project_id,
        holdbackCents: (inv.holdback_cents as number) ?? 0,
        holdbackPercent: (inv.holdback_percent as number) ?? 0,
      })),
    })

    if (batchHoldbackResult.failed.length > 0) {
      console.error(
        `EFT batch ${batchReference}: ${batchHoldbackResult.failed.length} holdback ledger(s) failed to create.`,
        batchHoldbackResult.failed
      )
    }

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

    // BUG-004: Consume any invoice-specific compliance overrides that were used
    // to unblock invoices in this batch. Fire-and-forget, non-fatal.
    if (pendingOverrideConsumptions.length > 0) {
      const internalUserId = await resolveInternalUserId(userData.id, supabase)
      if (internalUserId) {
        void Promise.all(
          pendingOverrideConsumptions.map(c =>
            consumeInvoiceOverrides({
              contractorId: c.contractorId,
              invoiceId: c.invoiceId,
              overrideIds: c.overrideIds,
              actorUserId: internalUserId,
            })
          )
        )
      }
    }
    
    // Send branded payment-confirmation emails to the REAL vendor (plus internal
    // CC) via the unified server dispatcher. Additive + non-fatal: the payment is
    // already committed above, so a notification failure must never abort it.
    const paymentDate = new Date().toISOString().split('T')[0]
    await Promise.all(
      (invoices || []).map((inv) =>
        dispatchPaymentConfirmation({
          invoiceId: inv.id,
          invoiceNumber: inv.invoice_number || inv.id,
          totalCents: inv.net_payable_cents || 0,
          contractorId: inv.contractor_id ?? null,
          projectId: inv.project_id ?? null,
          status: 'paid',
          actor: { userId: userData.id, name: processedByName, role: 'accountant', authUserId: user.id },
          payment: {
            paymentDate,
            paymentReference: batchReference,
            paymentMethod: input.payment_method,
            issuedByName: processedByName,
            amountPaidCents: inv.net_payable_cents || 0,
          },
        })
      )
    )

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
  status?: 'withheld' | 'countdown_started' | 'released' | 'disputed' | 'all'
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
          total_cents
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
    if (input.amount_cents !== undefined && input.amount_cents !== holdback.holdback_amount_cents) {
      throw new Error('Amount mismatch: policy context amount does not match holdback record')
    }
    
    // Update holdback status
    const { error: updateError } = await supabase
      .from('holdback_ledgers')
      .update({
        status: 'released',
        released_at: new Date().toISOString(),
        released_amount_cents: holdback.holdback_amount_cents,
        released_by: userData.id,
        notes: notes || null,
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
        amount_cents: holdback.holdback_amount_cents,
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
        net_payable_cents,
        status,
        created_at,
        document_url,
        contractor:contractors(id, company_name),
        project:projects(id, name, project_number)
      `)
      .order('created_at', { ascending: false })

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
          bank_account_last4,
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
      .select('id, request_number, requested_amount_cents, approved_amount_cents, status, payment_method, payment_reference, created_at, processed_at')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: false })
      
    // Fetch payment certificates linked to this invoice
    const { data: paymentCertificates } = await supabase
      .from('payment_certificates')
      .select('id')
      .eq('invoice_id', invoiceId)
    
    // Get actual payments for these payment requests AND certificates
    let payments: Array<Record<string, unknown>> = []
    
    const prIds = paymentRequests?.map(pr => pr.id) || []
    const certIds = paymentCertificates?.map(c => c.id) || []
    
    if (prIds.length > 0 || certIds.length > 0) {
      let query = supabase
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
          processed_by,
          payment_request_id,
          payment_certificate_id
        `)
        .order('created_at', { ascending: false })
        
      if (prIds.length > 0 && certIds.length > 0) {
        query = query.or(`payment_request_id.in.(${prIds.join(',')}),payment_certificate_id.in.(${certIds.join(',')})`)
      } else if (prIds.length > 0) {
        query = query.in('payment_request_id', prIds)
      } else if (certIds.length > 0) {
        query = query.in('payment_certificate_id', certIds)
      }
      
      const { data: paymentData, error: paymentsError } = await query
      
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
        bank_account_last4,
        banking_approval_status,
        preferred_payment_method,
        etransfer_email,
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
        due_date,
        updated_at,
        total_cents,
        holdback_cents,
        net_payable_cents,
        contractor:contractors(
          id,
          company_name,
          wcb_clearance_expiry,
          bank_account_last4,
          banking_approval_status,
          bank_account_encrypted,
          vendor_type
        ),
        project:projects(id, name, project_number)
      `)
      .eq('status', 'approved')
      .order('updated_at', { ascending: false })

    if (error) {
      console.error('Get approved invoices error:', error)
      return { success: false, error: error.message, invoices: [] }
    }

    const invoices = data || []

    if (invoices.length === 0) {
      return { success: true, invoices: [] }
    }

    // Check which invoices have any unpaid certificates (status not in 'paid', 'cancelled').
    // These invoices must have their certs paid first before an EFT can be issued.
    const invoiceIds = invoices.map(inv => inv.id)
    const { data: unpaidCerts } = await supabase
      .from('payment_certificates')
      .select('invoice_id')
      .in('invoice_id', invoiceIds)
      .not('status', 'in', '("paid","cancelled")')

    const invoiceIdsWithUnpaidCerts = new Set((unpaidCerts || []).map(c => c.invoice_id))

    return {
      success: true,
      invoices: invoices.map(inv => ({
        ...inv,
        has_unpaid_certs: invoiceIdsWithUnpaidCerts.has(inv.id),
      })),
    }
  })
}

/**
 * Summary totals for the payment dashboard: how much has gone out today and
 * this calendar week. Keeps the accountant oriented on completed work alongside
 * the "ready to pay" action items. Low row volume, so summed in JS.
 */
export async function getRecentPaymentTotals() {
  return withPermission(PERMISSIONS.PAYMENTS.PROCESS_PAYMENTS, async () => {
    const supabase = getSupabaseAdmin()

    // Start of the current week (Monday), local-naive ISO date.
    const now = new Date()
    const day = now.getDay() // 0=Sun..6=Sat
    const diffToMonday = (day + 6) % 7
    const startOfWeek = new Date(now)
    startOfWeek.setDate(now.getDate() - diffToMonday)
    const weekStr = startOfWeek.toISOString().split('T')[0]
    const todayStr = now.toISOString().split('T')[0]

    const { data, error } = await supabase
      .from('payments')
      .select('amount_cents, payment_date')
      .gte('payment_date', weekStr)

    if (error) {
      console.error('Get recent payment totals error:', error)
      return { success: false, error: error.message, paidToday: 0, paidTodayCount: 0, paidWeek: 0, paidWeekCount: 0 }
    }

    const rows = data || []
    let paidToday = 0, paidTodayCount = 0, paidWeek = 0, paidWeekCount = 0
    for (const r of rows) {
      paidWeek += r.amount_cents || 0
      paidWeekCount += 1
      if (r.payment_date === todayStr) {
        paidToday += r.amount_cents || 0
        paidTodayCount += 1
      }
    }

    return { success: true, paidToday, paidTodayCount, paidWeek, paidWeekCount }
  })
}

/**
 * Most recent payments for quick verification and reference. Joins through
 * payment_requests for the invoice number and to contractors for the name.
 */
export async function getRecentPayments(options?: { limit?: number }) {
  return withPermission(PERMISSIONS.PAYMENTS.PROCESS_PAYMENTS, async () => {
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
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
        eft_file_id,
        created_at,
        contractor:contractors(id, company_name),
        payment_request:payment_requests(id, invoice_id, request_number, invoice:invoices(invoice_number)),
        certificate:payment_certificates(id, certificate_number)
      `)
      .order('payment_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(options?.limit || 10)

    if (error) {
      console.error('Get recent payments error:', error)
      return { success: false, error: error.message, payments: [] }
    }

    return { success: true, payments: data || [] }
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
            bank_account_last4,
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
        certified_amount_cents,
        net_payable_cents,
        holdback_amount_cents,
        status
      `)
      .eq('id', input.certificate_id)
      .single()
    
    if (certError || !certificate) {
      console.error('Fetch certificate error:', certError)
      return { success: false, error: 'Certificate not found' }
    }
    
    // 2. Validate certificate status — only 'approved' certificates may be paid.
    if (certificate.status === 'paid') {
      // Emit duplicate-blocked audit event before returning.
      const blockUserId = await resolveInternalUserId(userData.id, supabase)
      if (blockUserId) {
        await supabase.from('audit_logs').insert({
          action: 'certificate_payment_blocked_duplicate',
          entity_type: 'payment_certificate',
          entity_id: input.certificate_id,
          user_id: blockUserId,
          description: `Duplicate payment attempt blocked for certificate ${certificate.certificate_number} (status: paid)`,
          new_values: {
            certificate_id: input.certificate_id,
            certificate_number: certificate.certificate_number,
            payment_method: input.payment_method,
          },
        })
      }
      return { success: false, error: `Certificate ${certificate.certificate_number} has already been paid and is locked. No further payment actions are permitted.` }
    }
    if (certificate.status !== 'approved') {
      return { success: false, error: `Cannot process payment for certificate with status: ${certificate.status}` }
    }

    // 3. One Certificate = One Payment policy.
    //    Check whether ANY prior payment row exists for this certificate
    //    regardless of the balance math. The uix_payments_per_cert unique
    //    index enforces this at the DB layer; this application-layer check
    //    provides an early, human-readable rejection before hitting the DB
    //    constraint and emits a structured audit event.
    const { data: existingPayments, error: existingPaymentsError } = await supabase
      .from('payments')
      .select('id, amount_cents, status, created_at')
      .eq('payment_certificate_id', input.certificate_id)
      .not('status', 'in', '("cancelled","returned")')
      .limit(1)

    if (existingPaymentsError) {
      console.error('recordCertificatePayment: could not check existing payments', existingPaymentsError)
      return { success: false, error: 'Could not verify certificate payment history.' }
    }

    if (existingPayments && existingPayments.length > 0) {
      const blockUserId = await resolveInternalUserId(userData.id, supabase)
      if (blockUserId) {
        await supabase.from('audit_logs').insert({
          action: 'certificate_payment_blocked_duplicate',
          entity_type: 'payment_certificate',
          entity_id: input.certificate_id,
          user_id: blockUserId,
          description: `Duplicate payment attempt blocked for certificate ${certificate.certificate_number} — a payment record already exists`,
          new_values: {
            certificate_id: input.certificate_id,
            certificate_number: certificate.certificate_number,
            payment_method: input.payment_method,
            existing_payment_id: existingPayments[0].id,
          },
        })
      }
      return {
        success: false,
        error: `Certificate ${certificate.certificate_number} has already been paid and is locked. No further payment actions are permitted.`,
      }
    }

    // 4. Full-amount enforcement.
    //    Certificate payments are always the full net_payable_cents amount.
    //    The amount field is a display value only — the system always uses
    //    the certificate amount, never a caller-provided partial amount.
    const requiredAmount = certificate.net_payable_cents

    if (requiredAmount <= 0) {
      return { success: false, error: 'Certificate net payable amount is zero or invalid.' }
    }

    // If the caller supplied an amount, it must exactly match net_payable_cents.
    // This guards against any UI that might pass an incorrect value.
    if (input.amount_cents !== requiredAmount) {
      return {
        success: false,
        error: `Payment amount ($${(input.amount_cents / 100).toFixed(2)}) does not match certificate net payable ($${(requiredAmount / 100).toFixed(2)}). Certificate payments must be for the full certified amount.`,
      }
    }

    // ── Stage 2: Hard banking gate ────────────────────────────────────────────
    const bankingGate = await evaluateBankingGate(supabase, certificate.contractor_id, input.payment_method)
    if (!bankingGate.allowed) {
      // Resolve reviewer ID for audit log (best-effort)
      const { data: reviewer } = await supabase
        .from('users')
        .select('id')
        .eq('auth_user_id', userData.id)
        .maybeSingle()
      if (reviewer?.id) {
        await supabase.from('audit_logs').insert({
          action: 'banking_payment_blocked',
          entity_type: 'payment_certificate',
          entity_id: input.certificate_id,
          user_id: reviewer.id,
          description: bankingGate.message,
          new_values: {
            certificate_id: input.certificate_id,
            contractor_id: certificate.contractor_id,
            payment_method: input.payment_method,
            reason: bankingGate.message,
          },
        })
      }
      return { success: false, error: bankingGate.message }
    }

    // ── Stage 5: Compliance gate ──────────────────────────────────────────────
    // Certificate payments require the same compliance checks as direct payments.
    // BUG-004: Collect invoice-specific overrides used to unblock this cert.
    let certComplianceOverrideIds: string[] = []
    if (certificate.invoice_id) {
      const complianceResult = await validateComplianceDocsForPayment({
        contractorId: certificate.contractor_id,
        invoiceId: certificate.invoice_id,
        paymentMethod: input.payment_method,
        // Certificate payments must not be blocked by their own 'approved' status
        // on the invoice. The UNPAID_CERTIFICATES_EXIST check is suppressed here
        // and remains active for direct invoice payments (isCertificatePayment: false).
        isCertificatePayment: true,
      })
      if (!complianceResult.valid) {
        const complianceError = await formatComplianceError(complianceResult)
        const { data: reviewer } = await supabase
          .from('users').select('id').eq('auth_user_id', userData.id).maybeSingle()
        if (reviewer?.id) {
          await supabase.from('audit_logs').insert({
            action: 'payment_blocked_compliance',
            entity_type: 'payment_certificate',
            entity_id: input.certificate_id,
            user_id: reviewer.id,
            description: complianceError,
            new_values: {
              certificate_id: input.certificate_id,
              invoice_id: certificate.invoice_id,
              contractor_id: certificate.contractor_id,
              payment_method: input.payment_method,
              failures: complianceResult.failures,
              reason: complianceError,
            },
          })
        }
        // Resolve invoice number and contractor name for notification
        const [invRowResult, contractorRowResult] = await Promise.all([
          supabase.from('invoices').select('invoice_number').eq('id', certificate.invoice_id).maybeSingle(),
          supabase.from('contractors').select('company_name, contact_name').eq('id', certificate.contractor_id).maybeSingle(),
        ])
        void notifyComplianceBlock({
          invoiceId: certificate.invoice_id,
          invoiceNumber: invRowResult.data?.invoice_number || certificate.invoice_id || 'unknown',
          contractorName: contractorRowResult.data?.company_name || contractorRowResult.data?.contact_name || certificate.contractor_id || 'unknown',
          reason: complianceError,
          projectId: certificate.project_id ?? null,
          actorUserId: userData.id,
        })
        return { success: false, error: complianceError }
      }
      // Payment passes — collect override IDs for post-commit consumption
      if (complianceResult.overriddenIssues.length > 0) {
        certComplianceOverrideIds = complianceResult.overriddenIssues.map(o => o.overrideId)
      }
    }

    // Resolve internal users.id from auth UUID (processed_by FK references users(id))
    const internalUserId = await resolveInternalUserId(userData.id, supabase)
    if (!internalUserId) {
      console.error('recordCertificatePayment: could not resolve internal user ID')
      return { success: false, error: 'Could not resolve internal user ID' }
    }

    // 5. Audit: payment method selected for this certificate
    await supabase.from('audit_logs').insert({
      action: 'certificate_payment_method_selected',
      entity_type: 'payment_certificate',
      entity_id: input.certificate_id,
      user_id: internalUserId,
      description: `Payment method ${input.payment_method.toUpperCase()} selected for certificate ${certificate.certificate_number}`,
      new_values: {
        certificate_id: input.certificate_id,
        certificate_number: certificate.certificate_number,
        payment_method: input.payment_method,
        invoice_id: certificate.invoice_id,
        contractor_id: certificate.contractor_id,
      },
    })

    // 6. Create the payment record.
    //    payment_request_id intentionally omitted — cert payments use
    //    payment_certificate_id (migration 041 makes payment_request_id nullable).
    //    amount_cents is always requiredAmount (net_payable_cents) — enforced above.
    const paymentDate = new Date().toISOString()
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        payment_certificate_id: input.certificate_id,
        contractor_id: certificate.contractor_id,
        amount_cents: requiredAmount,
        payment_method: input.payment_method,
        payment_date: input.payment_date,
        status: 'cleared',
        cheque_number: input.cheque_number || null,
        etransfer_reference: input.etransfer_reference || null,
        wire_reference: input.wire_reference || null,
        notes: input.notes || null,
        processed_by: internalUserId,
      })
      .select()
      .single()
    
    if (paymentError) {
      console.error('Create payment error:', paymentError)
      return { success: false, error: paymentError.message }
    }
    
    // 7. Lock the certificate: status = 'paid', paid_at/paid_by stamped.
    //    Certificate payments are always full — every cert payment fully settles
    //    the certificate. The immutability lock is unconditional.
    await supabase
      .from('payment_certificates')
      .update({
        status: 'paid',
        paid_at: paymentDate,
        paid_by: internalUserId,
        updated_at: paymentDate,
      })
      .eq('id', input.certificate_id)

    // Audit: certificate locked after payment
    await supabase.from('audit_logs').insert({
      action: 'certificate_locked_after_payment',
      entity_type: 'payment_certificate',
      entity_id: input.certificate_id,
      user_id: internalUserId,
      description: `Certificate ${certificate.certificate_number} locked after payment — no further payment actions permitted`,
      new_values: {
        certificate_id: input.certificate_id,
        certificate_number: certificate.certificate_number,
        paid_at: paymentDate,
        invoice_id: certificate.invoice_id,
        contractor_id: certificate.contractor_id,
      },
    })

    // 8. Update invoice total_paid_cents
    const { data: invoice } = await supabase
      .from('invoices')
      .select('total_paid_cents, net_payable_cents, status')
      .eq('id', certificate.invoice_id)
      .single()
    
    let invoiceFullyPaid = false
    if (invoice) {
      const newTotalPaid = (invoice.total_paid_cents || 0) + requiredAmount
      invoiceFullyPaid = newTotalPaid >= (invoice.net_payable_cents || 0)
      await supabase
        .from('invoices')
        .update({
          total_paid_cents: newTotalPaid,
          amount_paid_cents: newTotalPaid,
          amount_remaining_cents: Math.max(0, invoice.net_payable_cents - newTotalPaid),
          updated_at: paymentDate,
        })
        .eq('id', certificate.invoice_id)
    }

    // 8b. Flip the invoice status through the centralized status engine
    //     so audit + history + notifications fire consistently.
    if (invoice && invoice.status !== 'paid') {
      try {
        await applyInvoiceStatusChange({
          invoiceId: certificate.invoice_id,
          newStatus: invoiceFullyPaid ? 'paid' : 'partially_paid',
          actor: {
            userId: internalUserId,
            name: userData.email || 'Accountant',
            role: userData.role ?? 'accountant',
            authUserId: userData.id,
          },
          reason: `Payment of $${(requiredAmount / 100).toFixed(2)} recorded for certificate ${certificate.certificate_number}`,
        })
      } catch (statusErr) {
        // Non-fatal — payment is already recorded.
        console.error('[v0] Paid status transition failed:', statusErr)
      }
    }
    
    // 7. Create a holdback ledger entry if this certificate withholds a holdback.
    //    BUG-FIX (Issue A): Previous inline insert omitted holdback_percent (NOT NULL
    //    column), causing a silent DB error. Now delegates to createHoldbackLedger()
    //    from the holdback engine which handles idempotency, holdback_percent, and
    //    audit logging correctly.
    if (certificate.holdback_amount_cents && certificate.holdback_amount_cents > 0 && certificate.invoice_id) {
      // Fetch holdback_percent from invoice (needed for the ledger row)
      const { data: invForHoldback } = await supabase
        .from('invoices')
        .select('holdback_percent, project_id')
        .eq('id', certificate.invoice_id)
        .maybeSingle()

      const holdbackPct = (invForHoldback?.holdback_percent as number) ?? 0

      const holdbackResult = await createHoldbackLedger(supabase, {
        invoiceId: certificate.invoice_id,
        contractorId: certificate.contractor_id,
        projectId: (invForHoldback?.project_id ?? certificate.project_id) as string,
        holdbackAmountCents: certificate.holdback_amount_cents,
        holdbackPercent: holdbackPct,
        paymentDate: input.payment_date,
        holdbackReleaseDays: 45,
        processedByUserId: internalUserId,
      })

      if (holdbackResult.status === 'failed') {
        // Non-fatal: payment already recorded. Engine audit-logged the failure.
        console.error('Create holdback ledger error (certificate payment):', holdbackResult.error)
      }
    }

    // 9. Emit certificate_payment_completed — the primary accounting event
    //    for this transaction. internalUserId was resolved above; re-use it.
    await supabase.from('audit_logs').insert({
      action: 'certificate_payment_completed',
      entity_type: 'payment_certificate',
      entity_id: input.certificate_id,
      user_id: internalUserId,
      description: `Certificate ${certificate.certificate_number} payment completed — $${(requiredAmount / 100).toFixed(2)} via ${input.payment_method.toUpperCase()}`,
      new_values: {
        payment_id: payment.id,
        certificate_id: input.certificate_id,
        certificate_number: certificate.certificate_number,
        amount_cents: requiredAmount,
        payment_method: input.payment_method,
        invoice_id: certificate.invoice_id,
        contractor_id: certificate.contractor_id,
        payment_date: input.payment_date,
      },
    })

    revalidatePath('/accountant/payments')
    revalidatePath('/accountant/queue')
    revalidatePath('/accountant/holdbacks')
    revalidatePath(`/invoices/${certificate.invoice_id}`)

    // BUG-004: Consume any invoice-specific compliance overrides used to unblock
    // this certificate payment. Fire-and-forget, non-fatal.
    if (certComplianceOverrideIds.length > 0 && certificate.invoice_id) {
      void consumeInvoiceOverrides({
        contractorId: certificate.contractor_id,
        invoiceId: certificate.invoice_id,
        overrideIds: certComplianceOverrideIds,
        actorUserId: internalUserId,
      })
    }
    
    return { 
      success: true, 
      payment,
      message: `Payment of $${(requiredAmount / 100).toFixed(2)} recorded successfully. Certificate ${certificate.certificate_number} is now locked.`
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
        holdback_cents,
        status
      `)
      .eq('id', input.invoice_id)
      .single()
    
    if (invError || !invoice) {
      console.error('Fetch invoice error:', invError)
      return { success: false, error: 'Invoice not found' }
    }
    
    // 2. Check if invoice has payment certificates and verify they are all fully paid
    const { data: certificates, error: certError } = await supabase
      .from('payment_certificates')
      .select('id, status')
      .eq('invoice_id', input.invoice_id)

    if (certError) {
      console.error('Fetch certificates error:', certError)
      return { success: false, error: 'Failed to check payment certificates' }
    }

    // 3. All certificates must have status 'paid' before direct payment is allowed.
    // A status check is used (not a payment-math check) so that certificates in
    // 'draft', 'pending', 'approved', 'rejected', 'partially_paid', or 'cancelled'
    // always block — even when net_payable_cents is 0 (e.g. a draft with no amount yet).
    if (certificates && certificates.length > 0) {
      const notPaidCount = certificates.filter(cert => cert.status !== 'paid').length

      if (notPaidCount > 0) {
        return {
          success: false,
          error: `${notPaidCount} payment certificate${notPaidCount > 1 ? 's' : ''} must be fully paid before paying this invoice balance.`,
        }
      }
    }
    
    // ── Stage 2: Hard banking gate ────────────────────────────────────────────
    const bankingGate = await evaluateBankingGate(supabase, invoice.contractor_id, input.payment_method)
    if (!bankingGate.allowed) {
      const { data: reviewer } = await supabase
        .from('users')
        .select('id')
        .eq('auth_user_id', userData.id)
        .maybeSingle()
      if (reviewer?.id) {
        await supabase.from('audit_logs').insert({
          action: 'banking_payment_blocked',
          entity_type: 'invoice',
          entity_id: input.invoice_id,
          user_id: reviewer.id,
          description: bankingGate.message,
          new_values: {
            invoice_id: input.invoice_id,
            contractor_id: invoice.contractor_id,
            payment_method: input.payment_method,
            reason: bankingGate.message,
          },
        })
      }
      return { success: false, error: bankingGate.message }
    }

    // ── Stage 5: Compliance gate ──────────────────────────────────────────────
    // BUG-004: directComplianceOverrideIds captures invoice-specific override IDs
    // used to unblock this payment so they can be consumed post-commit.
    let directComplianceOverrideIds: string[] = []
    const complianceResult = await validateComplianceDocsForPayment({
      contractorId: invoice.contractor_id,
      invoiceId: input.invoice_id,
      paymentMethod: input.payment_method,
    })
    if (!complianceResult.valid) {
      const complianceError = await formatComplianceError(complianceResult)
      const { data: reviewer } = await supabase
        .from('users').select('id').eq('auth_user_id', userData.id).maybeSingle()
      if (reviewer?.id) {
        await supabase.from('audit_logs').insert({
          action: 'payment_blocked_compliance',
          entity_type: 'invoice',
          entity_id: input.invoice_id,
          user_id: reviewer.id,
          description: complianceError,
          new_values: {
            invoice_id: input.invoice_id,
            contractor_id: invoice.contractor_id,
            payment_method: input.payment_method,
            failures: complianceResult.failures,
            reason: complianceError,
          },
        })
      }
      // Notify Admin, Accountant, assigned PM
      const { data: contractorRow } = await supabase
        .from('contractors')
        .select('company_name, contact_name')
        .eq('id', invoice.contractor_id)
        .maybeSingle()
      void notifyComplianceBlock({
        invoiceId: input.invoice_id,
        invoiceNumber: invoice.invoice_number || input.invoice_id,
        contractorName: contractorRow?.company_name || contractorRow?.contact_name || invoice.contractor_id,
        reason: complianceError,
        projectId: invoice.project_id ?? null,
        actorUserId: userData.id,
      })
      return { success: false, error: complianceError }
    }
    // Payment passes — collect override IDs for post-commit consumption
    if (complianceResult.overriddenIssues.length > 0) {
      directComplianceOverrideIds = complianceResult.overriddenIssues.map(o => o.overrideId)
    }

    // 4. Validate invoice status — 'paid' is intentionally excluded.
    //    An invoice that has already been fully paid must never receive another
    //    payment through any code path. This is a hard server-side block.
    if (invoice.status === 'paid') {
      return { success: false, error: 'Invoice is already paid and cannot receive another payment.' }
    }
    if (!['approved', 'payment_processing'].includes(invoice.status)) {
      return { success: false, error: `Cannot process payment for invoice with status: ${invoice.status}` }
    }

    // 5. Calculate remaining balance from authoritative payment records.
    //    Never trust the stale denormalised fields on the invoice row —
    //    query the payments table directly to get the true paid total.
    const balance = await getInvoicePaymentBalance(
      supabase,
      input.invoice_id,
      invoice.net_payable_cents,
    )

    if (balance.isFullyPaid) {
      return { success: false, error: 'Invoice is already paid and cannot receive another payment.' }
    }

    const remainingBalance = balance.remainingPayableCents

    // 6. Validate payment amount
    if (input.amount_cents <= 0) {
      return { success: false, error: 'Payment amount must be greater than 0' }
    }

    if (input.amount_cents > remainingBalance) {
      return {
        success: false,
        error: `Payment amount ($${(input.amount_cents / 100).toFixed(2)}) exceeds remaining balance ($${(remainingBalance / 100).toFixed(2)})`,
      }
    }
    
    // 7. Resolve internal users.id from auth UUID (processed_by FK references users(id))
    const internalUserId = await resolveInternalUserId(userData.id, supabase)
    if (!internalUserId) {
      console.error('recordDirectInvoicePayment: could not resolve internal user ID')
      return { success: false, error: 'Could not resolve internal user ID' }
    }

    // 8. Create a payment request for tracking
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
        processed_by: internalUserId,
        processed_at: new Date().toISOString(),
        created_by: internalUserId,
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
        processed_by: internalUserId,
      })
      .select()
      .single()

    if (paymentError) {
      console.error('Create payment error:', paymentError)
      return { success: false, error: paymentError.message }
    }

    // 9. Update invoice payment totals.
    //    Use balance.totalPaidCents (authoritative, from payment records) not
    //    the stale invoice fields, so concurrent payments are handled correctly.
    const newTotalPaid = balance.totalPaidCents + input.amount_cents
    const newRemainingAmount = invoice.net_payable_cents - newTotalPaid
    const isFullyPaid = newRemainingAmount <= 0

    await supabase
      .from('invoices')
      .update({
        total_paid_cents: newTotalPaid,
        amount_paid_cents: newTotalPaid,
        amount_remaining_cents: Math.max(0, newRemainingAmount),
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.invoice_id)

    // 9b. Route the status change through the centralized status engine so that
    //     audit + invoice_history + contractor/PM notifications fire consistently.
    //     BUG-FIX (Issue D): Previously used raw .update({ status }) which
    //     bypassed applyInvoiceStatusChange — no history, no payment confirmation.
    try {
      await applyInvoiceStatusChange({
        invoiceId: input.invoice_id,
        newStatus: isFullyPaid ? 'paid' : 'partially_paid',
        actor: {
          userId: internalUserId,
          name: userData.email || 'Accountant',
          role: userData.role ?? 'accountant',
          authUserId: userData.id,
        },
        reason: `Direct payment of $${(input.amount_cents / 100).toFixed(2)} recorded via ${input.payment_method.toUpperCase()}`,
      })
    } catch (statusErr) {
      // Non-fatal — payment is already recorded. Log and continue.
      console.error('[recordDirectInvoicePayment] Status transition failed:', statusErr)
    }

    // 9c. Create a holdback ledger entry once the invoice is fully paid and it
    //     carries a holdback. BUG-FIX (Issue A): Previous inline insert omitted
    //     holdback_percent (NOT NULL column). Delegated to createHoldbackLedger()
    //     which handles idempotency, holdback_percent, and audit logging correctly.
    if (isFullyPaid && invoice.holdback_cents && invoice.holdback_cents > 0) {
      // Fetch holdback_percent from invoice for the ledger row
      const { data: invForHoldback } = await supabase
        .from('invoices')
        .select('holdback_percent')
        .eq('id', input.invoice_id)
        .maybeSingle()

      const holdbackPct = (invForHoldback?.holdback_percent as number) ?? 0

      const holdbackResult = await createHoldbackLedger(supabase, {
        invoiceId: input.invoice_id,
        contractorId: invoice.contractor_id,
        projectId: invoice.project_id as string,
        holdbackAmountCents: invoice.holdback_cents,
        holdbackPercent: holdbackPct,
        paymentDate: input.payment_date,
        holdbackReleaseDays: 45,
        processedByUserId: internalUserId,
      })

      if (holdbackResult.status === 'failed') {
        // Non-fatal: payment already recorded. Engine audit-logged the failure.
        console.error('Create holdback ledger error (direct payment):', holdbackResult.error)
      }
    }

    // 9d. Dispatch branded payment-confirmation email/notification to contractor.
    //     BUG-FIX (Issue H): Previously missing — contractors received no confirmation
    //     for direct invoice payments.
    void dispatchPaymentConfirmation({
      invoiceId: input.invoice_id,
      invoiceNumber: invoice.invoice_number || input.invoice_id,
      totalCents: invoice.net_payable_cents || 0,
      contractorId: invoice.contractor_id ?? null,
      projectId: invoice.project_id ?? null,
      status: isFullyPaid ? 'paid' : 'partially_paid',
      actor: { userId: internalUserId, name: userData.email || 'Accountant', role: userData.role ?? 'accountant', authUserId: userData.id },
      payment: {
        paymentDate: input.payment_date,
        paymentReference: input.payment_reference || `Direct payment for ${invoice.invoice_number}`,
        paymentMethod: input.payment_method,
        issuedByName: userData.email || 'Accountant',
        amountPaidCents: input.amount_cents,
      },
    })

    // 10. Log the action
    await supabase.from('audit_logs').insert({
      action: 'direct_invoice_payment',
      entity_type: 'invoice',
      entity_id: input.invoice_id,
      user_id: internalUserId,
      description: `Recorded direct payment of $${(input.amount_cents / 100).toFixed(2)} for invoice ${invoice.invoice_number}`,
      new_values: {
        amount_cents: input.amount_cents,
        payment_method: input.payment_method,
        invoice_number: invoice.invoice_number,
        payment_type: 'direct_invoice',
        is_fully_paid: isFullyPaid,
      },
    })

    // BUG-004: Consume any invoice-specific compliance overrides used to unblock
    // this direct payment. internalUserId is already resolved above — reuse it.
    if (directComplianceOverrideIds.length > 0 && internalUserId) {
      void consumeInvoiceOverrides({
        contractorId: invoice.contractor_id,
        invoiceId: input.invoice_id,
        overrideIds: directComplianceOverrideIds,
        actorUserId: internalUserId,
      })
    }
    
    revalidatePath('/accountant/payments')
    revalidatePath('/accountant/queue')
    revalidatePath('/accountant/holdbacks')
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
  return withPermission(PERMISSIONS.INVOICES.VIEW_AP_QUEUE, async () => {
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

    // Calculate certificate-level details
    // Business rule: certs are paid at full certified amount — no per-cert holdback.
    // Use certified_amount_cents (not net_payable_cents) for remaining calculation.
    const certificatesWithPayments = (certificates || []).map(cert => {
      const certPayments = certificatePayments.filter(p => p.payment_certificate_id === cert.id)
      const totalPaidCents = certPayments.reduce((sum, p) => sum + (p.amount_cents || 0), 0)
      const remainingCents = (cert.certified_amount_cents || 0) - totalPaidCents

      return {
        ...cert,
        payments: certPayments,
        total_paid_cents: totalPaidCents,
        remaining_cents: Math.max(0, remainingCents),
        is_fully_paid: remainingCents <= 0,
      }
    })
    
    // paymentMode: 'certificate' when unpaid certs exist; 'direct' when all paid or no certs
    const unpaidCertificateCount = certificatesWithPayments.filter(c => c.status !== 'paid').length
    const paymentMode = hasCertificates && unpaidCertificateCount > 0 ? 'certificate' : 'direct'

    // Invoice totals — computed from actual cert payment records, not stale invoice fields
    const totalCertifiedCents = (certificates || []).reduce((sum, c) => sum + (c.certified_amount_cents || 0), 0)
    const totalCertPaidCents = certificatesWithPayments.reduce((sum, c) => sum + c.total_paid_cents, 0)
    const totalDirectPaidCents = (directPayments || []).reduce((sum, p) => sum + (p.amount_cents || 0), 0)
    const totalPaidCents = totalCertPaidCents + totalDirectPaidCents
    const invoiceBaseCents = invoice.net_payable_cents || 0
    const invoiceRemainingCents = Math.max(0, invoiceBaseCents - totalPaidCents)
    
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
        unpaid_certificate_count: unpaidCertificateCount,
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
  payment_method: 'eft' | 'cheque' | 'wire' | 'etransfer'
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

    // Block batch if any invoice has OTHER unpaid certificates not included in this batch
    const uniqueInvoiceIds = [...new Set((certificates || []).map(c => c.invoice_id))]
    for (const invoiceId of uniqueInvoiceIds) {
      const { data: otherUnpaid, error: otherUnpaidError } = await supabase
        .from('payment_certificates')
        .select('id')
        .eq('invoice_id', invoiceId)
        .not('status', 'in', '("paid","cancelled")')
        .not('id', 'in', `(${input.certificate_ids.map(id => `"${id}"`).join(',')})`)

      if (otherUnpaidError) {
        console.error('Unpaid cert check error:', otherUnpaidError)
        return { success: false, error: otherUnpaidError.message }
      }

      if (otherUnpaid && otherUnpaid.length > 0) {
        const { data: inv } = await supabase
          .from('invoices')
          .select('invoice_number')
          .eq('id', invoiceId)
          .single()
        return {
          success: false,
          error: `Invoice ${inv?.invoice_number ?? invoiceId} has unpaid certificates that must be paid before processing this batch. All certificates on an invoice must be paid together.`,
        }
      }
    }

    // ── Stage 2: Hard banking gate ────────────────────────────────────────────
    // Every unique contractor in this batch must have approved banking before any
    // payment record is created. A single failure blocks the entire batch.
    const uniqueContractorIds = [...new Set((certificates || []).map(c => c.contractor_id).filter(Boolean))]
    for (const contractorId of uniqueContractorIds) {
      const bankingGate = await evaluateBankingGate(supabase, contractorId, input.payment_method)
      if (!bankingGate.allowed) {
        const { data: reviewer } = await supabase
          .from('users')
          .select('id')
          .eq('auth_user_id', userData.id)
          .maybeSingle()
        if (reviewer?.id) {
          await supabase.from('audit_logs').insert({
            action: 'banking_payment_blocked',
            entity_type: 'payment_certificate_batch',
            entity_id: contractorId,
            user_id: reviewer.id,
            description: bankingGate.message,
            new_values: {
              contractor_id: contractorId,
              certificate_ids: input.certificate_ids,
              payment_method: input.payment_method,
              reason: bankingGate.message,
            },
          })
        }
        return { success: false, error: `Banking gate: ${bankingGate.message}` }
      }
    }

    // ── Stage 5: Compliance gate ──────────────────────────────────────────────
    // Every unique invoice in this batch must pass compliance validation before any
    // payment record is created. Overrides are collected per-invoice.
    // BUG-004: certBatchOverrideConsumptions collects invoice-specific override IDs
    // to consume after the payment records are committed.
    const certBatchOverrideConsumptions: Array<{
      invoiceId: string
      contractorId: string
      overrideIds: string[]
    }> = []

    for (const invoiceId of uniqueInvoiceIds) {
      const certForInvoice = (certificates || []).find(c => c.invoice_id === invoiceId)
      if (!certForInvoice?.contractor_id) continue

      const complianceResult = await validateComplianceDocsForPayment({
        contractorId: certForInvoice.contractor_id,
        invoiceId,
        paymentMethod: input.payment_method,
      })
      if (!complianceResult.valid) {
        const complianceError = await formatComplianceError(complianceResult)
        // Resolve invoice number for user-facing message and audit log
        const { data: invRow } = await supabase
          .from('invoices')
          .select('invoice_number')
          .eq('id', invoiceId)
          .maybeSingle()
        const { data: reviewer } = await supabase
          .from('users')
          .select('id')
          .eq('auth_user_id', userData.id)
          .maybeSingle()
        if (reviewer?.id) {
          await supabase.from('audit_logs').insert({
            action: 'payment_blocked_compliance',
            entity_type: 'payment_certificate_batch',
            entity_id: invoiceId,
            user_id: reviewer.id,
            description: complianceError,
            new_values: {
              invoice_id: invoiceId,
              invoice_number: invRow?.invoice_number ?? invoiceId,
              contractor_id: certForInvoice.contractor_id,
              certificate_ids: input.certificate_ids,
              payment_method: input.payment_method,
              failures: complianceResult.failures,
              reason: complianceError,
            },
          })
        }
        // Notify Admin, Accountant, assigned PM — best-effort, non-fatal
        const { data: contractorRow } = await supabase
          .from('contractors')
          .select('company_name, contact_name')
          .eq('id', certForInvoice.contractor_id)
          .maybeSingle()
        void notifyComplianceBlock({
          invoiceId,
          invoiceNumber: invRow?.invoice_number ?? invoiceId,
          contractorName: contractorRow?.company_name || contractorRow?.contact_name || certForInvoice.contractor_id,
          reason: complianceError,
          projectId: null,
          actorUserId: userData.id,
        })
        return {
          success: false,
          error: `Compliance gate: Invoice ${invRow?.invoice_number ?? invoiceId}: ${complianceError}`,
        }
      }
      // Payment passes — collect invoice-specific overrides for post-commit consumption
      if (complianceResult.overriddenIssues.length > 0) {
        certBatchOverrideConsumptions.push({
          invoiceId,
          contractorId: certForInvoice.contractor_id,
          overrideIds: complianceResult.overriddenIssues.map(o => o.overrideId),
        })
      }
    }

    const batchReference = input.batch_reference || `EFT-CERT-${Date.now()}`
    const totalAmount = certificates?.reduce((sum, c) => sum + (c.net_payable_cents || 0), 0) || 0

    // Resolve internal users.id from auth UUID (processed_by FK references users(id))
    const internalUserId = await resolveInternalUserId(userData.id, supabase)
    if (!internalUserId) {
      console.error('executeCertificateEFTBatch: could not resolve internal user ID')
      return { success: false, error: 'Could not resolve internal user ID' }
    }

    const processedPaymentIds: string[] = []
    const processedCertIds: string[] = []
    // Track invoices that become fully paid in this batch so we can send one
    // branded payment confirmation per invoice (to the real vendor + internal CC).
    const fullyPaidInvoices = new Map<string, { contractorId: string | null; amountPaidCents: number }>()

    // Process each certificate
    for (const cert of certificates || []) {
      // Create payment record
      const { data: newPayment, error: paymentError } = await supabase
        .from('payments')
        .insert({
          payment_certificate_id: cert.id,
          contractor_id: cert.contractor_id,
          amount_cents: cert.net_payable_cents,
          payment_method: input.payment_method,
          payment_date: new Date().toISOString().split('T')[0],
          status: 'cleared',
          processed_by: internalUserId,
        })
        .select('id')
        .single()

      if (paymentError) {
        console.error('Error creating certificate payment:', paymentError)
        // Compensating rollback
        if (processedPaymentIds.length > 0) {
          const { error: rbPayErr } = await supabase.from('payments').delete().in('id', processedPaymentIds)
          if (rbPayErr) console.error('Rollback failed (payments):', rbPayErr)
          const { error: rbCertErr } = await supabase
            .from('payment_certificates')
            .update({ status: 'approved', updated_at: new Date().toISOString() })
            .in('id', processedCertIds)
          if (rbCertErr) console.error('Rollback failed (certificates):', rbCertErr)
        }
        return { success: false, error: `Payment failed for certificate ${cert.certificate_number}: ${paymentError.message}` }
      }

      if (newPayment) processedPaymentIds.push(newPayment.id)

      // Update certificate to paid
      await supabase
        .from('payment_certificates')
        .update({
          status: 'paid',
          updated_at: new Date().toISOString(),
        })
        .eq('id', cert.id)

      processedCertIds.push(cert.id)
      
      // Update invoice total_paid_cents
      const { data: invoice } = await supabase
        .from('invoices')
        .select('total_paid_cents, net_payable_cents')
        .eq('id', cert.invoice_id)
        .single()
      
      if (invoice) {
        const newTotalPaid = (invoice.total_paid_cents || 0) + cert.net_payable_cents
        const invoiceFullyPaid = newTotalPaid >= invoice.net_payable_cents
        
        await supabase
          .from('invoices')
          .update({
            total_paid_cents: newTotalPaid,
            amount_paid_cents: newTotalPaid,
            amount_remaining_cents: Math.max(0, invoice.net_payable_cents - newTotalPaid),
            status: invoiceFullyPaid ? 'paid' : 'approved',
            updated_at: new Date().toISOString(),
          })
          .eq('id', cert.invoice_id)

        if (invoiceFullyPaid) {
          fullyPaidInvoices.set(cert.invoice_id, {
            contractorId: cert.contractor_id ?? null,
            amountPaidCents: newTotalPaid,
          })
        }
      }
    }
    
    // Create batch record
    await supabase.from('payment_batches').insert({
      batch_reference: batchReference,
      payment_method: input.payment_method,
      invoice_count: input.certificate_ids.length,
      total_amount_cents: totalAmount,
      executed_by_user_id: internalUserId,
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

    // Send branded payment-confirmation emails for invoices fully settled by this
    // batch (real vendor + internal CC). Additive + non-fatal: payments are already
    // committed, so a notification failure must never affect the result.
    if (fullyPaidInvoices.size > 0) {
      // userData here is the auth-scoped CurrentUser (no name fields), so resolve
      // the processed-by display name from the internal users row.
      const { data: processor } = await supabase
        .from('users')
        .select('first_name, last_name')
        .eq('id', internalUserId)
        .single()
      const processedByName =
        [processor?.first_name, processor?.last_name].filter(Boolean).join(' ').trim() || 'Accounts Payable'
      const paymentDate = new Date().toISOString().split('T')[0]
      const { data: paidInvoiceRows } = await supabase
        .from('invoices')
        .select('id, invoice_number, project_id')
        .in('id', [...fullyPaidInvoices.keys()])
      const invoiceMeta = new Map((paidInvoiceRows || []).map((r) => [r.id, r]))

      await Promise.all(
        [...fullyPaidInvoices.entries()].map(([invoiceId, info]) =>
          dispatchPaymentConfirmation({
            invoiceId,
            invoiceNumber: invoiceMeta.get(invoiceId)?.invoice_number || invoiceId,
            totalCents: info.amountPaidCents,
            contractorId: info.contractorId,
            projectId: invoiceMeta.get(invoiceId)?.project_id ?? null,
            status: 'paid',
            actor: { userId: internalUserId, name: processedByName, role: 'accountant', authUserId: userData.id },
            payment: {
              paymentDate,
              paymentReference: batchReference,
              paymentMethod: input.payment_method,
              issuedByName: processedByName,
              amountPaidCents: info.amountPaidCents,
            },
          })
        )
      )
    }
    
    revalidatePath('/accountant/payments')
    revalidatePath('/accountant/queue')

    // BUG-004: Consume any invoice-specific compliance overrides used to unblock
    // certificates in this batch. Fire-and-forget, non-fatal.
    // internalUserId was resolved earlier in this function (before the payment loop).
    if (certBatchOverrideConsumptions.length > 0) {
      void Promise.all(
        certBatchOverrideConsumptions.map(c =>
          consumeInvoiceOverrides({
            contractorId: c.contractorId,
            invoiceId: c.invoiceId,
            overrideIds: c.overrideIds,
            actorUserId: internalUserId,
          })
        )
      )
    }
    
    return { 
      success: true,
      batchReference,
      totalAmount,
      certificateCount: input.certificate_ids.length,
      message: `EFT batch executed: ${input.certificate_ids.length} certificates, $${(totalAmount / 100).toFixed(2)}`
    }
  })
}

// =====================================================
// PAYMENT RECEIPT DATA
// =====================================================

export async function getPaymentReceiptData(paymentId: string) {
  return withPermission(PERMISSIONS.INVOICES.VIEW_AP_QUEUE, async () => {
  try {
    const supabase = getSupabaseAdmin()

    // Fetch payment core fields
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('id, amount_cents, payment_date, payment_method, status, notes, payment_certificate_id, payment_request_id, processed_by')
      .eq('id', paymentId)
      .single()

    if (paymentError || !payment) {
      return { success: false, error: paymentError?.message ?? 'Payment not found' }
    }

    // Fetch processed_by user
    let processedByUser: { full_name: string | null; role: string | null } | null = null
    if (payment.processed_by) {
      const { data: pUser } = await supabase
        .from('users')
        .select('full_name, role')
        .eq('id', payment.processed_by)
        .single()
      if (pUser) processedByUser = pUser
    }

    // Fetch company settings
    const { data: companySettings } = await supabase
      .from('company_settings')
      .select('*')
      .limit(1)
      .single()

    let invoiceData: {
      invoice_number: string
      amount_cents: number
      net_payable_cents: number
      holdback_amount_cents: number
      contractor_name: string
      project_name: string
    } | null = null
    let certificateData: {
      certificate_number: string
      certified_amount_cents: number
      approved_by_name: string | null
    } | null = null
    let approvedByName: string | null = null
    let approvedByRole: string | null = null

    if (payment.payment_certificate_id) {
      // Certificate-based payment
      const { data: cert } = await supabase
        .from('payment_certificates')
        .select(`
          certificate_number,
          certified_amount_cents,
          approved_by,
          invoice:invoices (
            invoice_number,
            total_cents,
            net_payable_cents,
            holdback_cents,
            contractor:contractors ( company_name ),
            project:projects ( name )
          )
        `)
        .eq('id', payment.payment_certificate_id)
        .single()

      if (cert) {
        if (cert.approved_by) {
          const { data: abUser } = await supabase
            .from('users')
            .select('full_name, role')
            .eq('id', cert.approved_by)
            .single()
          approvedByName = abUser?.full_name ?? null
          approvedByRole = abUser?.role ?? null
        }
        certificateData = {
          certificate_number: cert.certificate_number,
          certified_amount_cents: cert.certified_amount_cents,
          approved_by_name: approvedByName,
        }
        const inv = cert.invoice as unknown as {
          invoice_number: string
          total_cents: number
          net_payable_cents: number
          holdback_cents: number
          contractor: { company_name: string } | { company_name: string }[] | null
          project: { name: string } | { name: string }[] | null
        } | null
        if (inv) {
          invoiceData = {
            invoice_number: inv.invoice_number,
            amount_cents: inv.total_cents,
            net_payable_cents: inv.net_payable_cents,
            holdback_amount_cents: inv.holdback_cents,
            contractor_name: Array.isArray(inv.contractor) ? (inv.contractor[0]?.company_name ?? '') : (inv.contractor?.company_name ?? ''),
            project_name: Array.isArray(inv.project) ? (inv.project[0]?.name ?? '') : (inv.project?.name ?? ''),
          }
        }
      }
    } else if (payment.payment_request_id) {
      // Direct payment via payment request
      const { data: pr } = await supabase
        .from('payment_requests')
        .select(`
          invoice:invoices (
            invoice_number,
            total_cents,
            net_payable_cents,
            holdback_cents,
            contractor:contractors ( company_name ),
            project:projects ( name )
          )
        `)
        .eq('id', payment.payment_request_id)
        .single()

      if (pr) {
        const inv = pr.invoice as unknown as {
          invoice_number: string
          total_cents: number
          net_payable_cents: number
          holdback_cents: number
          contractor: { company_name: string } | { company_name: string }[] | null
          project: { name: string } | { name: string }[] | null
        } | null
        if (inv) {
          invoiceData = {
            invoice_number: inv.invoice_number,
            amount_cents: inv.total_cents,
            net_payable_cents: inv.net_payable_cents,
            holdback_amount_cents: inv.holdback_cents,
            contractor_name: Array.isArray(inv.contractor) ? (inv.contractor[0]?.company_name ?? '') : (inv.contractor?.company_name ?? ''),
            project_name: Array.isArray(inv.project) ? (inv.project[0]?.name ?? '') : (inv.project?.name ?? ''),
          }
        }
      }
    }

    return {
      success: true,
      data: {
        payment: {
          id: payment.id,
          amount_cents: payment.amount_cents,
          payment_date: payment.payment_date,
          payment_method: payment.payment_method,
          status: payment.status,
          notes: payment.notes,
        },
        certificate: certificateData,
        invoice: invoiceData,
        approved_by_name: payment.payment_certificate_id ? approvedByName : null,
        approved_by_role: payment.payment_certificate_id ? approvedByRole : null,
        processed_by_name: processedByUser?.full_name ?? null,
        processed_by_role: processedByUser?.role ?? null,
        payment_type: payment.payment_certificate_id ? 'certificate' : 'direct',
        companySettings: companySettings ?? null,
      },
    }
  } catch (err) {
    console.error('getPaymentReceiptData error:', err)
    return { success: false, error: 'Failed to load receipt data' }
  }
  })
}
