/**
 * Banking Gate — Stage 2 Hard Payment Block
 *
 * This module is the single source of truth for EFT banking validation.
 * It is called by every payment execution path before any payment record
 * is created, any invoice status is updated, or any certificate status changes.
 *
 * Rules enforced:
 *   1. If payment method is EFT: banking status MUST be 'approved'.
 *   2. Required encrypted banking fields MUST exist.
 *   3. No pending banking_change_request may exist for the contractor.
 *
 * For non-EFT payment methods (cheque, wire, etransfer) the banking gate is
 * not applied — those paths do not require EFT bank account approval.
 *
 * Stage 3+ will add compliance and approval-limit gates here.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Public types ─────────────────────────────────────────────────────────────

export type BankingGateStatus =
  | 'approved'           // Gate passed — payment may proceed
  | 'not_submitted'      // No banking information on file
  | 'pending_review'     // Submitted but not yet reviewed
  | 'rejected'           // Reviewer rejected the banking details
  | 'superseded'         // A pending change request has superseded the current record
  | 'pending_change'     // Approved but a new change request is awaiting review
  | 'missing_data'       // Status is approved but encrypted fields are absent
  | 'skipped_non_eft'    // Payment method is not EFT — gate not applicable

export interface BankingGateResult {
  /** Whether payment execution may proceed */
  allowed: boolean
  /** Machine-readable status for audit logging */
  status: BankingGateStatus
  /**
   * Human-readable message to surface to the accountant and return from the
   * payment action if blocked.
   * Example: "Payment blocked. Contractor banking information is missing or not approved."
   */
  message: string
}

// ─── Internal helper ─────────────────────────────────────────────────────────

const BLOCKED = (status: BankingGateStatus, message: string): BankingGateResult => ({
  allowed: false,
  status,
  message,
})

const ALLOWED: BankingGateResult = {
  allowed: true,
  status: 'approved',
  message: 'Banking approved.',
}

// ─── Main gate function ───────────────────────────────────────────────────────

/**
 * Evaluate whether an EFT payment may proceed for the given contractor.
 *
 * @param supabase   Admin Supabase client (service role) — needed to bypass RLS.
 * @param contractorId  The contractors.id UUID.
 * @param paymentMethod The payment method on this transaction.
 * @returns BankingGateResult — check .allowed before creating any payment record.
 */
export async function evaluateBankingGate(
  supabase: SupabaseClient,
  contractorId: string,
  paymentMethod: 'eft' | 'cheque' | 'wire' | 'etransfer'
): Promise<BankingGateResult> {
  // ── eTransfer gate ────────────────────────────────────────────────────────
  // eTransfer requires an approved contractor profile and a valid etransfer_email.
  // It does NOT require bank account details (no EFT banking profile needed).
  if (paymentMethod === 'etransfer') {
    const { data: contractor, error } = await supabase
      .from('contractors')
      .select('id, status, etransfer_email')
      .eq('id', contractorId)
      .single()

    if (error || !contractor) {
      return BLOCKED('not_submitted', 'Payment blocked. Contractor record not found — eTransfer email cannot be verified.')
    }

    const etransferEmail = (contractor.etransfer_email as string | null)?.trim()
    if (!etransferEmail) {
      return BLOCKED(
        'not_submitted',
        'Payment blocked. No eTransfer email address is on file for this contractor. The contractor must add an eTransfer email before an eTransfer payment can be processed.'
      )
    }

    // Basic email format validation (RFC-5321 local-part@domain)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(etransferEmail)) {
      return BLOCKED(
        'missing_data',
        `Payment blocked. The contractor's eTransfer email address (${etransferEmail}) is not a valid email format.`
      )
    }

    return { allowed: true, status: 'approved', message: 'eTransfer approved.' }
  }

  // ── Non-EFT, non-eTransfer gate (cheque, wire) ───────────────────────────
  if (paymentMethod !== 'eft') {
    return { allowed: true, status: 'skipped_non_eft', message: 'Banking gate not required for this payment method.' }
  }

  // ── EFT gate ──────────────────────────────────────────────────────────────

  // ── 1. Fetch contractor banking columns ────────────────────────────────────
  const { data: contractor, error } = await supabase
    .from('contractors')
    .select('id, banking_approval_status, bank_account_encrypted, bank_account_last4')
    .eq('id', contractorId)
    .single()

  if (error || !contractor) {
    return BLOCKED('not_submitted', 'Payment blocked. Contractor record not found — banking cannot be verified.')
  }

  const bankingStatus = (contractor.banking_approval_status as string | null) ?? 'not_submitted'

  // ── 2. Status-based gates ──────────────────────────────────────────────────

  switch (bankingStatus) {
    case 'not_submitted':
      return BLOCKED(
        'not_submitted',
        'Payment blocked. Contractor banking information is missing or not approved. No banking details have been submitted.'
      )

    case 'pending_review':
      return BLOCKED(
        'pending_review',
        'Payment blocked. Contractor banking information is pending review. An accountant or admin must approve the banking details before payment can proceed.'
      )

    case 'rejected':
      return BLOCKED(
        'rejected',
        'Payment blocked. Contractor banking information has been rejected. The contractor must re-submit corrected banking details before payment can proceed.'
      )

    case 'superseded':
      // A new change request is in progress; current record is stale
      return BLOCKED(
        'superseded',
        'Payment blocked. A pending banking change request is under review. Payment is held until the new banking details are approved or rejected.'
      )

    case 'approved':
      // ── 3. Approved — verify encrypted data is present ──────────────────
      if (!contractor.bank_account_encrypted && !contractor.bank_account_last4) {
        return BLOCKED(
          'missing_data',
          'Payment blocked. Banking profile is marked approved but the encrypted account data is missing. Please re-enter the contractor\'s banking details.'
        )
      }
      // ── 4. Check for a pending change request (even if currently approved) –
      {
        const { data: pendingChange } = await supabase
          .from('banking_change_requests')
          .select('id')
          .eq('contractor_id', contractorId)
          .eq('status', 'pending')
          .limit(1)
          .maybeSingle()

        if (pendingChange) {
          return BLOCKED(
            'pending_change',
            'Payment blocked. The contractor has submitted a new banking change request that is awaiting review. Payment is held to prevent fraud until the change is approved or rejected.'
          )
        }
      }
      return ALLOWED

    default:
      // Unknown status — block by default (fail-safe)
      return BLOCKED(
        'not_submitted',
        `Payment blocked. Contractor banking information is missing or not approved (status: ${bankingStatus}).`
      )
  }
}

/**
 * Validate banking for all contractors referenced by a set of invoice IDs.
 * Used by the batch EFT path (executeEFTPayment / processPayments).
 *
 * Returns null when all contractors pass the gate.
 * Returns a descriptive error string to surface to the caller when any fail.
 */
export async function validateBankingForInvoiceBatch(
  supabase: SupabaseClient,
  invoiceIds: string[],
  paymentMethod: 'eft' | 'cheque' | 'wire' | 'etransfer'
): Promise<string | null> {
  if (paymentMethod !== 'eft') return null

  // Fetch contractor_ids from invoices in a single query
  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('id, contractor_id')
    .in('id', invoiceIds)

  if (error || !invoices?.length) {
    return 'Payment blocked. Could not retrieve invoice contractor data for banking validation.'
  }

  // Deduplicate contractor IDs (multiple invoices may belong to the same contractor)
  const uniqueContractorIds = [...new Set(invoices.map((inv) => inv.contractor_id as string))]

  for (const contractorId of uniqueContractorIds) {
    const result = await evaluateBankingGate(supabase, contractorId, paymentMethod)
    if (!result.allowed) {
      // Find associated invoices for context
      const invoiceNums = invoices
        .filter((inv) => inv.contractor_id === contractorId)
        .map((inv) => inv.id)
        .join(', ')
      return `${result.message} (invoices: ${invoiceNums})`
    }
  }

  return null
}
