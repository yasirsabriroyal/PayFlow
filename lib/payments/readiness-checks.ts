'use server'

/**
 * Readiness Check Data Fetchers
 *
 * These functions query Supabase to build the ReadinessInput object that
 * the Payment Readiness Engine evaluates. Each function is responsible for
 * one domain of data (banking, compliance, holdback, approval, invoice state).
 *
 * All queries are read-only. No writes happen here.
 *
 * Called by: app/accountant/readiness/actions.ts → getInvoiceReadinessReport()
 */

import { createClient } from '@/lib/supabase/server'
import type { ReadinessInput } from './readiness-engine'

// ============================================
// SYSTEM SETTINGS FETCHER
// ============================================

interface ReadinessSystemSettings {
  requireLienWaiver: boolean
  blockWcbExpired: boolean
}

export async function fetchReadinessSystemSettings(): Promise<ReadinessSystemSettings> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('system_settings')
    .select('key, value')
    .in('key', ['require_lien_waiver', 'block_wcb_expired'])

  if (error || !data) {
    // Safe defaults: enforced WCB, advisory lien waiver
    return { requireLienWaiver: true, blockWcbExpired: true }
  }

  const settings: ReadinessSystemSettings = { requireLienWaiver: true, blockWcbExpired: true }
  for (const row of data) {
    if (row.key === 'require_lien_waiver') {
      settings.requireLienWaiver = row.value === true || row.value === 'true'
    } else if (row.key === 'block_wcb_expired') {
      settings.blockWcbExpired = row.value === true || row.value === 'true'
    }
  }
  return settings
}

// ============================================
// INVOICE + CONTRACTOR DATA FETCHER
// ============================================

interface InvoiceContractorData {
  invoiceId: string
  invoiceStatus: string
  totalCents: number
  holdbackCents: number
  contractorId: string
  // Banking (Stage 1: from contractors table columns)
  hasBankingData: boolean
  bankingApprovalStatus: string | null  // null until Stage 2 DB migration
  wcbClearanceExpiry: string | null
  // Approval
  approvedByUserId: string | null
}

export async function fetchInvoiceContractorData(
  invoiceId: string
): Promise<InvoiceContractorData | null> {
  const supabase = await createClient()

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select(`
      id,
      status,
      total_cents,
      holdback_cents,
      contractor_id,
      approved_by,
      contractors!inner (
        id,
        bank_account_encrypted,
        bank_account_last4,
        banking_approval_status,
        wcb_clearance_expiry
      )
    `)
    .eq('id', invoiceId)
    .single()

  if (error || !invoice) return null

  const contractor = Array.isArray(invoice.contractors)
    ? invoice.contractors[0]
    : invoice.contractors

  // Determine banking data presence.
  // bank_account_encrypted is a text column — it has encrypted data if non-null.
  // bank_account_last4 is a secondary signal (masked display hint).
  const hasBankingData =
    contractor?.bank_account_encrypted != null ||
    contractor?.bank_account_last4 != null

  return {
    invoiceId: invoice.id,
    invoiceStatus: invoice.status,
    totalCents: invoice.total_cents ?? 0,
    holdbackCents: invoice.holdback_cents ?? 0,
    contractorId: invoice.contractor_id,
    hasBankingData,
    // banking_approval_status does not exist yet (Stage 2 migration).
    // The column select will return undefined/null — that's intentional.
    // The engine handles null bankingApprovalStatus via the Stage 1 path.
    bankingApprovalStatus: (contractor as Record<string, unknown>)?.banking_approval_status as string | null ?? null,
    wcbClearanceExpiry: contractor?.wcb_clearance_expiry ?? null,
    approvedByUserId: invoice.approved_by ?? null,
  }
}

// ============================================
// BANKING CHANGE REQUESTS FETCHER
// ============================================

export async function fetchHasPendingBankingChangeRequest(
  contractorId: string
): Promise<boolean> {
  const supabase = await createClient()

  const { count, error } = await supabase
    .from('banking_change_requests')
    .select('id', { count: 'exact', head: true })
    .eq('contractor_id', contractorId)
    .eq('status', 'pending')

  if (error) return false
  return (count ?? 0) > 0
}

// ============================================
// INSURANCE CERTIFICATE FETCHER
// ============================================

export async function fetchInsuranceCertificateExpiry(
  contractorId: string
): Promise<string | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('vendor_kyc_documents')
    .select('expiry_date, status')
    .eq('contractor_id', contractorId)
    .eq('document_type', 'insurance_certificate')
    .in('status', ['verified', 'expiring'])
    .order('expiry_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return data.expiry_date ?? null
}

// ============================================
// LIEN WAIVER FETCHER
// ============================================

/**
 * Stage 1: Returns null (not yet checked) — the engine skips this check.
 * Stage 3: Will query lien_waivers table by invoice_id (after invoice_id FK is added).
 */
export async function fetchHasSignedLienWaiver(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _invoiceId: string
): Promise<boolean | null> {
  // Stage 1: Not implemented yet. Return null to signal "not checked".
  // The engine treats null as "skip this check" to avoid false positives.
  return null
}

// ============================================
// HOLDBACK LEDGER FETCHER
// ============================================

interface HoldbackLedgerState {
  ledgerExists: boolean
  paidWithoutHoldbackRecord: boolean
}

export async function fetchHoldbackLedgerState(
  invoiceId: string,
  invoiceStatus: string,
  holdbackCents: number
): Promise<HoldbackLedgerState> {
  const supabase = await createClient()

  const { count, error } = await supabase
    .from('holdback_ledgers')
    .select('id', { count: 'exact', head: true })
    .eq('invoice_id', invoiceId)

  if (error) {
    return { ledgerExists: false, paidWithoutHoldbackRecord: false }
  }

  const ledgerExists = (count ?? 0) > 0
  const paidWithoutHoldbackRecord =
    invoiceStatus === 'paid' && holdbackCents > 0 && !ledgerExists

  return { ledgerExists, paidWithoutHoldbackRecord }
}

// ============================================
// CERTIFICATE STATE FETCHER
// ============================================

interface CertificateState {
  hasUnpaidCertificates: boolean
  allCertificatesPaid: boolean
}

export async function fetchCertificateState(invoiceId: string): Promise<CertificateState> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('payment_certificates')
    .select('id, status')
    .eq('invoice_id', invoiceId)

  if (error || !data || data.length === 0) {
    return { hasUnpaidCertificates: false, allCertificatesPaid: true }
  }

  const unpaid = data.filter(c => c.status !== 'paid')
  return {
    hasUnpaidCertificates: unpaid.length > 0,
    allCertificatesPaid: unpaid.length === 0,
  }
}

// ============================================
// APPROVAL LIMIT FETCHER
// ============================================

interface ApprovalLimitState {
  approverLimitCents: number | null
  approvalLimitExceeded: boolean
}

export async function fetchApprovalLimitState(
  approvedByUserId: string | null,
  invoiceTotalCents: number
): Promise<ApprovalLimitState> {
  if (!approvedByUserId) {
    return { approverLimitCents: null, approvalLimitExceeded: false }
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('users')
    .select('approval_limit_cents, role')
    .eq('id', approvedByUserId)
    .single()

  if (error || !data) {
    return { approverLimitCents: null, approvalLimitExceeded: false }
  }

  // Admins and accountants have no limit — only PMs
  if (data.role !== 'project_manager') {
    return { approverLimitCents: null, approvalLimitExceeded: false }
  }

  const limitCents = data.approval_limit_cents ?? null
  const approvalLimitExceeded =
    limitCents !== null && invoiceTotalCents > limitCents

  return { approverLimitCents: limitCents, approvalLimitExceeded }
}

// ============================================
// MASTER ASSEMBLER
// Builds the full ReadinessInput for a single invoice in parallel.
// ============================================

export async function buildReadinessInput(
  invoiceId: string
): Promise<ReadinessInput | { error: string }> {
  // Step 1: Core invoice + contractor data (serial — everything else depends on this)
  const invoiceData = await fetchInvoiceContractorData(invoiceId)
  if (!invoiceData) {
    return { error: `Invoice ${invoiceId} not found or access denied.` }
  }

  // Step 2: All independent checks run in parallel
  const [
    systemSettings,
    hasPendingBankingChangeRequest,
    insuranceCertificateExpiry,
    hasSignedLienWaiver,
    holdbackLedgerState,
    certificateState,
    approvalLimitState,
  ] = await Promise.all([
    fetchReadinessSystemSettings(),
    fetchHasPendingBankingChangeRequest(invoiceData.contractorId),
    fetchInsuranceCertificateExpiry(invoiceData.contractorId),
    fetchHasSignedLienWaiver(invoiceId),
    fetchHoldbackLedgerState(invoiceId, invoiceData.invoiceStatus, invoiceData.holdbackCents),
    fetchCertificateState(invoiceId),
    fetchApprovalLimitState(invoiceData.approvedByUserId, invoiceData.totalCents),
  ])

  return {
    invoiceId,
    invoiceStatus: invoiceData.invoiceStatus,
    totalCents: invoiceData.totalCents,
    holdbackCents: invoiceData.holdbackCents,
    bankingApprovalStatus: invoiceData.bankingApprovalStatus,
    hasBankingData: invoiceData.hasBankingData,
    hasPendingBankingChangeRequest,
    wcbClearanceExpiry: invoiceData.wcbClearanceExpiry,
    insuranceCertificateExpiry,
    hasSignedLienWaiver,
    hasCurrentLicense: null,      // Stage 3+
    hasCurrentSafetyCert: null,   // Stage 3+
    holdbackLedgerExists: holdbackLedgerState.ledgerExists,
    paidWithoutHoldbackRecord: holdbackLedgerState.paidWithoutHoldbackRecord,
    approverLimitCents: approvalLimitState.approverLimitCents,
    approvedByUserId: invoiceData.approvedByUserId,
    approvalLimitExceeded: approvalLimitState.approvalLimitExceeded,
    hasUnpaidCertificates: certificateState.hasUnpaidCertificates,
    allCertificatesPaid: certificateState.allCertificatesPaid,
    requireLienWaiver: systemSettings.requireLienWaiver,
    blockWcbExpired: systemSettings.blockWcbExpired,
  }
}
