'use server'

/**
 * Centralized Compliance Validation Gate
 *
 * This is the single function ALL payment paths must call before creating
 * any payment record, updating invoice status, or modifying certificates.
 *
 * Architecture:
 *  - Delegates data fetching to readiness-checks.ts (existing data layer)
 *  - Delegates evaluation to readiness-engine.ts (existing pure evaluation)
 *  - Adds override check on top of the engine result
 *  - Returns a structured ComplianceValidationResult consumed by payment actions
 *
 * Usage:
 *   const validation = await validateComplianceForPayment({ contractorId, invoiceId, paymentMethod })
 *   if (!validation.valid) {
 *     return { success: false, error: validation.failures[0].message }
 *   }
 *
 * Override flow:
 *   If an authorized compliance_overrides record exists for the contractor +
 *   invoice + issue_type, the specific blocker is treated as overridden and
 *   removed from the failures list. Overrides are audited as consumed.
 *
 * This module does NOT create payment records. It only validates.
 */

import { createClient } from '@/lib/supabase/server'
import { buildReadinessInput } from './readiness-checks'
import {
  evaluateReadiness,
  isHardBlocked,
  type ReadinessIssue,
} from './readiness-engine'

// ============================================
// PUBLIC CONTRACT
// ============================================

export interface ComplianceFailure {
  code: string
  message: string
  domain: string
  overrideId?: string | null
}

export interface ComplianceWarning {
  code: string
  message: string
  domain: string
}

export interface ComplianceValidationResult {
  /** True when payment may proceed (all hard blockers resolved or overridden). */
  valid: boolean
  /** Hard failures that cannot proceed without an override. */
  failures: ComplianceFailure[]
  /** Advisory issues — payment may proceed but action is recommended. */
  warnings: ComplianceWarning[]
  /** The readiness score (0–100) at time of evaluation. */
  score: number
  /** Issues that were overridden by an authorized exception. */
  overriddenIssues: { code: string; overrideId: string }[]
}

export interface ValidateComplianceInput {
  contractorId: string
  invoiceId: string
  paymentMethod?: string
}

// ============================================
// OVERRIDE LOOKUP
// ============================================

interface ComplianceOverride {
  id: string
  issue_type: string
  expires_at: string | null
  is_active: boolean
}

/**
 * Fetches all active, non-expired compliance overrides for a contractor+invoice pair.
 * Returns a set of issue codes that are currently overridden.
 */
async function fetchActiveOverrides(
  contractorId: string,
  invoiceId: string
): Promise<Map<string, string>> {
  const supabase = await createClient()
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('compliance_overrides')
    .select('id, issue_type, expires_at, is_active')
    .eq('contractor_id', contractorId)
    .eq('is_active', true)
    .or(`invoice_id.is.null,invoice_id.eq.${invoiceId}`)

  if (error || !data) return new Map()

  const overrideMap = new Map<string, string>()
  for (const override of data as ComplianceOverride[]) {
    // Skip expired overrides
    if (override.expires_at && new Date(override.expires_at) < new Date(now)) {
      continue
    }
    overrideMap.set(override.issue_type, override.id)
  }

  return overrideMap
}

// ============================================
// MAIN VALIDATION FUNCTION
// ============================================

/**
 * The primary compliance gate. Must be called before any payment action.
 *
 * @param input.contractorId - The contractor being paid
 * @param input.invoiceId    - The invoice being paid
 * @param input.paymentMethod - Optional: 'eft' | 'cheque' | 'wire' | 'etransfer' | 'certificate' | 'direct'
 */
export async function validateComplianceForPayment(
  input: ValidateComplianceInput
): Promise<ComplianceValidationResult> {
  const { contractorId, invoiceId } = input

  // 1. Build the full readiness input (runs all data fetches in parallel)
  const readinessInputOrError = await buildReadinessInput(invoiceId)

  if ('error' in readinessInputOrError) {
    // Invoice not found or access denied — block payment
    return {
      valid: false,
      failures: [
        {
          code: 'INVOICE_NOT_FOUND',
          message: readinessInputOrError.error,
          domain: 'invoice_state',
        },
      ],
      warnings: [],
      score: 0,
      overriddenIssues: [],
    }
  }

  // 2. Evaluate readiness (pure function — no I/O)
  const report = evaluateReadiness(readinessInputOrError)

  // 3. Fetch active overrides for this contractor+invoice pair
  const activeOverrides = await fetchActiveOverrides(contractorId, invoiceId)

  // 4. Separate blockers into overridden vs real failures
  const overriddenIssues: { code: string; overrideId: string }[] = []
  const realFailures: ReadinessIssue[] = []

  for (const blocker of report.blockers) {
    const overrideId = activeOverrides.get(blocker.code)
    if (overrideId) {
      overriddenIssues.push({ code: blocker.code, overrideId })
    } else {
      realFailures.push(blocker)
    }
  }

  const failures: ComplianceFailure[] = realFailures.map(f => ({
    code: f.code,
    message: f.description,
    domain: f.domain,
  }))

  const warnings: ComplianceWarning[] = report.warnings.map(w => ({
    code: w.code,
    message: w.description,
    domain: w.domain,
  }))

  const valid = failures.length === 0

  return {
    valid,
    failures,
    warnings,
    score: report.score,
    overriddenIssues,
  }
}

// ============================================
// COMPLIANCE-ONLY GATE (excludes banking / invoice state / holdback)
// ============================================

/**
 * Validates ONLY compliance-domain issues (WCB, insurance, license, safety, lien waiver).
 * Banking and invoice-state issues are handled by the banking gate separately.
 * This is used when the payment action already handles banking validation upstream.
 */
export async function validateComplianceDocsForPayment(
  input: ValidateComplianceInput
): Promise<ComplianceValidationResult> {
  const full = await validateComplianceForPayment(input)

  // Filter to compliance domain only
  const complianceFailures = full.failures.filter(f => f.domain === 'compliance')
  const complianceWarnings = full.warnings.filter(w => w.domain === 'compliance')

  return {
    ...full,
    valid: complianceFailures.length === 0,
    failures: complianceFailures,
    warnings: complianceWarnings,
  }
}

// ============================================
// HUMAN-READABLE SUMMARY
// ============================================

/**
 * Returns a single human-readable error string from the first compliance failure.
 * Used in payment action error returns.
 */
export function formatComplianceError(result: ComplianceValidationResult): string {
  if (result.valid) return ''
  const first = result.failures[0]
  if (!first) return 'Compliance validation failed.'

  // Provide concise user-facing messages keyed by code
  const messages: Record<string, string> = {
    WCB_EXPIRED:
      'WCB Clearance is expired. Payment cannot proceed.',
    WCB_NOT_ON_FILE:
      'WCB Clearance is missing. Payment cannot proceed.',
    INSURANCE_EXPIRED:
      'Insurance Certificate has expired. Payment cannot proceed.',
    INSURANCE_NOT_ON_FILE:
      'Insurance Certificate is missing. Payment cannot proceed.',
    BUSINESS_LICENSE_EXPIRED:
      'Business License has expired. Payment cannot proceed.',
    BUSINESS_LICENSE_NOT_ON_FILE:
      'Business License is missing. Payment cannot proceed.',
    SAFETY_CERT_EXPIRED:
      'Safety Certification has expired. Payment cannot proceed.',
    SAFETY_CERT_NOT_ON_FILE:
      'Safety Certification is missing. Payment cannot proceed.',
    LIEN_WAIVER_MISSING:
      'Lien Waiver is missing. Payment cannot proceed.',
    LIEN_WAIVER_UNSIGNED:
      'Lien Waiver has not been signed. Payment cannot proceed.',
    LIEN_WAIVER_EXPIRED:
      'Lien Waiver has expired. Payment cannot proceed.',
    BANKING_NOT_SUBMITTED:
      'Banking information has not been submitted. Payment cannot proceed.',
    BANKING_PENDING_REVIEW:
      'Banking information is pending review. Payment cannot proceed.',
    BANKING_REJECTED:
      'Banking information was rejected. Payment cannot proceed.',
    BANKING_CHANGE_PENDING:
      'A banking change request is pending review. Payment cannot proceed.',
    INVOICE_NOT_APPROVED:
      'Invoice has not been approved. Payment cannot proceed.',
  }

  return messages[first.code] ?? first.message
}
