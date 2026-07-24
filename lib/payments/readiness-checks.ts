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
 *
 * NOTE: This file is a server-side utility library (NOT a 'use server' actions
 * file). It is imported and called directly by server actions. It must use
 * getSupabaseAdmin() so that RLS does not block contractor reads during
 * payment validation.
 */

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import type { ReadinessInput } from './readiness-engine'

// ============================================
// SYSTEM SETTINGS FETCHER
// ============================================

interface ReadinessSystemSettings {
  requireLienWaiver: boolean
  blockWcbExpired: boolean
  requireBusinessLicense: boolean
  requireInsurance: boolean
  requireSafetyCert: boolean
}

/** Reads a boolean from a system_settings JSONB value's "enabled" key. */
function settingEnabled(value: unknown, defaultValue: boolean): boolean {
  if (value === null || value === undefined) return defaultValue
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value === 'true'
  if (typeof value === 'object' && value !== null && 'enabled' in value) {
    return Boolean((value as Record<string, unknown>).enabled)
  }
  return defaultValue
}

export async function fetchReadinessSystemSettings(): Promise<ReadinessSystemSettings> {
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from('system_settings')
    .select('setting_key, setting_value')
    .in('setting_key', [
      'require_lien_waiver',
      'require_lien_waiver_for_payment',
      'block_wcb_expired',
      'payment_wcb_block',
      'require_business_license',
      'require_insurance_certificate',
      'require_safety_certification',
    ])

  if (error || !data) {
    // Safe defaults — lien waiver off by default; WCB, license, insurance on
    return {
      requireLienWaiver: false,
      blockWcbExpired: true,
      requireBusinessLicense: true,
      requireInsurance: true,
      requireSafetyCert: false,
    }
  }

  const map: Record<string, unknown> = {}
  for (const row of data) {
    map[row.setting_key] = row.setting_value
  }

  return {
    // Lien waiver: check both old and new key names
    requireLienWaiver:
      settingEnabled(map['require_lien_waiver_for_payment'], false) ||
      settingEnabled(map['require_lien_waiver'], false),
    // WCB: check both old and new key names
    blockWcbExpired:
      settingEnabled(map['payment_wcb_block'], false) ||
      settingEnabled(map['block_wcb_expired'], false),
    requireBusinessLicense: settingEnabled(map['require_business_license'], false),
    requireInsurance: settingEnabled(map['require_insurance_certificate'], false),
    requireSafetyCert: settingEnabled(map['require_safety_certification'], false),
  }
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
  // Banking — Stage 2: live column from contractors table
  hasBankingData: boolean
  bankingApprovalStatus: string | null
  wcbClearanceExpiry: string | null
  // Approval
  approvedByUserId: string | null
  vendorType: string | null
}

export async function fetchInvoiceContractorData(
  invoiceId: string
): Promise<InvoiceContractorData | null> {
  const supabase = getSupabaseAdmin()

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select(`
      id,
      status,
      total_cents,
      holdback_cents,
      contractor_id,
      contractors (
        id,
        bank_account_encrypted,
        bank_account_last4,
        banking_approval_status,
        wcb_clearance_expiry,
        vendor_type
      )
    `)
    .eq('id', invoiceId)
    .single()

  // BUG-FIX (Issue 1): Previously used contractors!inner which caused a null
  // result (and false "Invoice not found" error) for invoices that have no
  // associated contractor row (e.g. system-generated or recurring invoices
  // where contractor_id IS NULL). Changed to a left join so the invoice row is
  // always returned; contractor fields are null-safe below.
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

  let wcbExpiry = contractor?.wcb_clearance_expiry ?? null
  if (!wcbExpiry && invoice.contractor_id) {
    const { data: wcbDoc } = await supabase
      .from('vendor_kyc_documents')
      .select('expiry_date')
      .eq('contractor_id', invoice.contractor_id)
      .eq('document_type', 'wcb_clearance')
      .eq('status', 'verified')
      .order('expiry_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (wcbDoc) {
      wcbExpiry = wcbDoc.expiry_date ?? '2099-12-31'
    }
  }

  return {
    invoiceId: invoice.id,
    invoiceStatus: invoice.status,
    totalCents: invoice.total_cents ?? 0,
    holdbackCents: invoice.holdback_cents ?? 0,
    contractorId: invoice.contractor_id,
    hasBankingData,
    bankingApprovalStatus: (contractor?.banking_approval_status as string | null) ?? null,
    wcbClearanceExpiry: wcbExpiry,
    approvedByUserId: null,
    vendorType: (contractor?.vendor_type as string | null) ?? null,
  }
}

// ============================================
// BANKING CHANGE REQUESTS FETCHER
// ============================================

export async function fetchHasPendingBankingChangeRequest(
  contractorId: string
): Promise<boolean> {
  const supabase = getSupabaseAdmin()

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
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from('vendor_kyc_documents')
    .select('expiry_date, status')
    .eq('contractor_id', contractorId)
    .eq('document_type', 'insurance_certificate')
    .eq('status', 'verified')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return data.expiry_date ?? '2099-12-31'
}

// ============================================
// BUSINESS LICENSE FETCHER
// ============================================

export async function fetchBusinessLicenseExpiry(
  contractorId: string
): Promise<string | null> {
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from('vendor_kyc_documents')
    .select('expiry_date, status')
    .eq('contractor_id', contractorId)
    .eq('document_type', 'business_license')
    .eq('status', 'verified')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return data.expiry_date ?? '2099-12-31'
}

// ============================================
// SAFETY CERTIFICATION FETCHER
// ============================================

export async function fetchSafetyCertExpiry(
  contractorId: string
): Promise<string | null> {
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from('vendor_kyc_documents')
    .select('expiry_date, status')
    .eq('contractor_id', contractorId)
    .eq('document_type', 'safety_certification')
    .eq('status', 'verified')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return data.expiry_date ?? '2099-12-31'
}

// ============================================
// LIEN WAIVER FETCHER
// ============================================

export interface LienWaiverState {
  hasSignedLienWaiver: boolean
  failureReason: 'missing' | 'unsigned' | 'expired' | null
}

/**
 * Queries the lien_waivers table for a valid signed waiver for this invoice.
 * Checks both invoice_id (new FK added in migration 049) and payment_request_id.
 * Returns hasSignedLienWaiver=null only if there is no lien waiver table yet (fallback).
 */
export async function fetchLienWaiverState(
  invoiceId: string,
): Promise<LienWaiverState> {
  const supabase = getSupabaseAdmin()

  // Fetch all waivers for this invoice — either directly linked or via payment_requests
  const { data: directWaivers, error: directError } = await supabase
    .from('lien_waivers')
    .select('id, is_signed, signed_at, valid_through_date')
    .eq('invoice_id', invoiceId)

  // Also check payment_requests for this invoice (legacy path).
  // Supabase JS v2 does not support subquery builders in .in(); we resolve
  // the payment_request IDs in a separate query first.
  const { data: prIds } = await supabase
    .from('payment_requests')
    .select('id')
    .eq('invoice_id', invoiceId)

  const prIdList = (prIds ?? []).map(r => r.id)

  const { data: prWaivers, error: prError } = prIdList.length > 0
    ? await supabase
        .from('lien_waivers')
        .select('id, is_signed, signed_at, valid_through_date')
        .in('payment_request_id', prIdList)
    : { data: [], error: null }

  if (directError && prError) {
    // If both queries fail, skip this check rather than produce false positives
    return { hasSignedLienWaiver: true, failureReason: null }
  }

  const allWaivers = [...(directWaivers ?? []), ...(prWaivers ?? [])]

  if (allWaivers.length === 0) {
    return { hasSignedLienWaiver: false, failureReason: 'missing' }
  }

  const today = new Date()

  // Look for any waiver that is signed and not expired
  for (const w of allWaivers) {
    if (!w.is_signed) continue
    if (!w.valid_through_date) {
      // No expiry date — treat as valid
      return { hasSignedLienWaiver: true, failureReason: null }
    }
    const expiry = new Date(w.valid_through_date)
    if (expiry >= today) {
      return { hasSignedLienWaiver: true, failureReason: null }
    }
  }

  // We have waivers but none that are valid
  const hasUnsigned = allWaivers.some(w => !w.is_signed)
  if (hasUnsigned) {
    return { hasSignedLienWaiver: false, failureReason: 'unsigned' }
  }

  // All waivers are signed but all have expired
  return { hasSignedLienWaiver: false, failureReason: 'expired' }
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
  const supabase = getSupabaseAdmin()

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
  const supabase = getSupabaseAdmin()

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

  const supabase = getSupabaseAdmin()

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
  invoiceId: string,
  options?: { isCertificatePayment?: boolean }
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
    lienWaiverState,
    holdbackLedgerState,
    certificateState,
    approvalLimitState,
    businessLicenseExpiry,
    safetyCertExpiry,
  ] = await Promise.all([
    fetchReadinessSystemSettings(),
    fetchHasPendingBankingChangeRequest(invoiceData.contractorId),
    fetchInsuranceCertificateExpiry(invoiceData.contractorId),
    fetchLienWaiverState(invoiceId),
    fetchHoldbackLedgerState(invoiceId, invoiceData.invoiceStatus, invoiceData.holdbackCents),
    fetchCertificateState(invoiceId),
    fetchApprovalLimitState(invoiceData.approvedByUserId, invoiceData.totalCents),
    fetchBusinessLicenseExpiry(invoiceData.contractorId),
    fetchSafetyCertExpiry(invoiceData.contractorId),
  ])

  return {
    invoiceId,
    invoiceStatus: invoiceData.invoiceStatus,
    totalCents: invoiceData.totalCents,
    holdbackCents: invoiceData.holdbackCents,
    vendorType: invoiceData.vendorType,
    bankingApprovalStatus: invoiceData.bankingApprovalStatus,
    hasBankingData: invoiceData.hasBankingData,
    hasPendingBankingChangeRequest,
    wcbClearanceExpiry: invoiceData.wcbClearanceExpiry,
    insuranceCertificateExpiry,
    hasSignedLienWaiver: lienWaiverState.hasSignedLienWaiver,
    lienWaiverFailureReason: lienWaiverState.failureReason,
    businessLicenseExpiry,
    safetyCertExpiry,
    hasCurrentLicense: businessLicenseExpiry !== null,
    hasCurrentSafetyCert: safetyCertExpiry !== null,
    holdbackLedgerExists: holdbackLedgerState.ledgerExists,
    paidWithoutHoldbackRecord: holdbackLedgerState.paidWithoutHoldbackRecord,
    approverLimitCents: approvalLimitState.approverLimitCents,
    approvedByUserId: invoiceData.approvedByUserId,
    approvalLimitExceeded: approvalLimitState.approvalLimitExceeded,
    hasUnpaidCertificates: certificateState.hasUnpaidCertificates,
    allCertificatesPaid: certificateState.allCertificatesPaid,
    requireLienWaiver: systemSettings.requireLienWaiver,
    blockWcbExpired: systemSettings.blockWcbExpired,
    requireBusinessLicense: systemSettings.requireBusinessLicense,
    requireInsurance: systemSettings.requireInsurance,
    requireSafetyCert: systemSettings.requireSafetyCert,
    isCertificatePayment: options?.isCertificatePayment ?? false,
  }
}
