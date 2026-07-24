/**
 * Payment Readiness Engine
 *
 * The single source of truth for whether an invoice is safe to pay.
 *
 * Architecture:
 *  - Pure evaluation logic lives here (no Supabase, no I/O).
 *  - Each check is a named, independently auditable function.
 *  - The engine returns a structured ReadinessReport used by:
 *      • Accountant portal badges (compact display)
 *      • Invoice detail panels (full breakdown)
 *      • Future payment actions (gate enforcement)
 *      • Future QuickBooks sync (pre-sync validation)
 *      • Future recurring expense payments (pre-generation validation)
 *
 * Stage 1: Evaluation + reporting only. No payments blocked.
 * Stage 2 (ACTIVE): Banking hard block is wired into executeEFTPayment,
 *   processPayments, recordCertificatePayment, and recordDirectInvoicePayment.
 *   bankingApprovalStatus is now a live database column on contractors.
 * Stage 3+: Additional hard blocks (compliance, approval limits) will be added.
 *
 * Scoring model (0–100):
 *   100 = Fully ready, no issues detected.
 *   Each issue deducts points from the base score:
 *     BLOCKER issues: -40 points (any single blocker → score ≤ 60 → "Not Ready")
 *     WARNING issues: -10 points each
 *   Score bands:
 *     80–100 = READY         (green)
 *     60–79  = WARNING       (amber — has warnings but no hard blocks)
 *     0–59   = NOT_READY     (red — has at least one blocker)
 */

// ============================================
// CORE TYPES — these are the public contract
// ============================================

/**
 * The type of enforcement this issue carries.
 *
 * BLOCKER  — hard-blocks payment. Will be enforced in payment actions once
 *             Stage 2–4 gates are wired in.
 * WARNING  — advisory. Can be overridden with a documented reason.
 * INFO     — informational only, no action required.
 */
export type ReadinessIssueLevel = 'BLOCKER' | 'WARNING' | 'INFO'

/**
 * Which check domain this issue belongs to.
 * Used for grouping in the UI and for filtering in future QB sync.
 */
export type ReadinessDomain =
  | 'banking'
  | 'compliance'
  | 'holdback'
  | 'approval'
  | 'invoice_state'

/**
 * A single identified issue, with its enforcement level and display metadata.
 */
export interface ReadinessIssue {
  /** Stable machine-readable key — used for audit logs and future override tracking */
  code: string
  /** Domain this issue belongs to */
  domain: ReadinessDomain
  /** Hard block or advisory */
  level: ReadinessIssueLevel
  /** Short display title (1 line) */
  title: string
  /** Full explanation shown in the detail panel */
  description: string
  /**
   * The recommended action the accountant should take.
   * Displayed as the CTA in the readiness panel.
   */
  recommendedAction: string
  /**
   * Whether this issue can be overridden with a documented reason.
   * Stage 4 will wire the override flow into payment actions.
   * false for BLOCKER items that must be resolved (not bypassed).
   */
  overridable: boolean
}

/** The final readiness verdict */
export type ReadinessStatus = 'READY' | 'WARNING' | 'NOT_READY'

/**
 * The full readiness report for a single invoice.
 * This is what is returned by getInvoiceReadiness() and consumed by all UI.
 */
export interface ReadinessReport {
  invoiceId: string
  /** Final verdict */
  status: ReadinessStatus
  /** 0–100 score. See scoring model in file header. */
  score: number
  /** All issues found, sorted by severity (BLOCKERs first, then WARNINGs) */
  issues: ReadinessIssue[]
  /** Convenience accessor: issues that are hard blocks */
  blockers: ReadinessIssue[]
  /** Convenience accessor: advisory issues */
  warnings: ReadinessIssue[]
  /** The single most important next action for the accountant to take */
  recommendedNextAction: string | null
  /** Timestamp of when this report was generated (ISO string) */
  evaluatedAt: string
  /**
   * Summary label for compact display in list rows.
   * e.g. "Ready to Pay", "Banking Required", "2 Issues"
   */
  summaryLabel: string
}

// ============================================
// INPUT CONTRACT
// ============================================

/**
 * All the data the engine needs to run every check.
 *
 * This is populated by the server action (readiness/actions.ts) via a single
 * Supabase query. The engine itself does no I/O — it only evaluates the data
 * it is given. This makes every check independently unit-testable.
 */
export interface ReadinessInput {
  invoiceId: string

  // --- Invoice state ---
  invoiceStatus: string
  totalCents: number
  holdbackCents: number
  vendorType: string | null

  // --- Banking ---
  /** Populated in Stage 2. Currently always null until banking status column is added. */
  bankingApprovalStatus: string | null
  /** True when bank_account_encrypted IS NOT NULL */
  hasBankingData: boolean
  /** True when at least one banking_change_requests row with status='pending' exists */
  hasPendingBankingChangeRequest: boolean

  // --- Compliance ---
  /**
   * WCB clearance expiry date (ISO string) from contractors.wcb_clearance_expiry.
   * Null = no WCB record on file.
   */
  wcbClearanceExpiry: string | null
  /**
   * Insurance certificate expiry from vendor_kyc_documents.
   * Null = not on file.
   */
  insuranceCertificateExpiry: string | null
  /**
   * Whether a signed lien waiver exists for this specific invoice.
   * Currently always null (Stage 1) — Stage 3 will wire a real query.
   */
  hasSignedLienWaiver: boolean | null
  /**
   * Whether required business/trade license is current.
   * null = not checked yet (Stage 3+)
   */
  hasCurrentLicense: boolean | null
  /**
   * Whether a valid safety certification is on file.
   * null = not checked yet (Stage 3+)
   */
  hasCurrentSafetyCert: boolean | null

  // --- Holdback ---
  /**
   * True when at least one holdback_ledgers row exists for this invoice.
   * Used to warn if a paid invoice has no holdback record.
   */
  holdbackLedgerExists: boolean
  /**
   * True when the invoice is marked paid but no holdback ledger exists
   * and holdbackCents > 0. This is the exact failure condition from the audit.
   */
  paidWithoutHoldbackRecord: boolean

  // --- Approval ---
  /**
   * The PM's approval limit in cents. Null = no limit configured (unlimited).
   */
  approverLimitCents: number | null
  /**
   * The user_id of the PM who approved the invoice.
   */
  approvedByUserId: string | null
  /**
   * True when the invoice was approved but the approver's limit
   * was exceeded at the time of approval. Stage 5 will backfill this.
   * For now we compute it from invoiceTotalCents vs approverLimitCents.
   */
  approvalLimitExceeded: boolean

  // --- Certificates ---
  /**
   * True when at least one payment_certificate exists with status != 'paid'
   * for this invoice. This invoice requires cert payment before direct EFT.
   */
  hasUnpaidCertificates: boolean
  /**
   * True when ALL certificates for this invoice are paid.
   * Required for direct invoice settlement.
   */
  allCertificatesPaid: boolean

  // --- Document expiry details (for nuanced lien waiver failures) ---
  /**
   * When hasSignedLienWaiver = false, the specific reason:
   * 'missing' | 'unsigned' | 'expired' | null (= not checked / waiver present)
   */
  lienWaiverFailureReason: 'missing' | 'unsigned' | 'expired' | null

  /**
   * Business license expiry from vendor_kyc_documents.
   * Null = not on file.
   */
  businessLicenseExpiry: string | null

  /**
   * Safety certification expiry from vendor_kyc_documents.
   * Null = not on file.
   */
  safetyCertExpiry: string | null

  // --- System settings (tenant-configurable) ---
  requireLienWaiver: boolean
  blockWcbExpired: boolean
  requireBusinessLicense: boolean
  requireInsurance: boolean
  requireSafetyCert: boolean

  // --- Payment context ---
  /**
   * Set to true when the readiness check is being run on behalf of a certificate
   * payment (not a direct invoice payment). When true, the UNPAID_CERTIFICATES_EXIST
   * blocker is suppressed — a certificate cannot be blocked by itself being unpaid.
   * Direct invoice payments always have this as false (default) and remain blocked
   * by any unpaid certificates on the invoice.
   */
  isCertificatePayment?: boolean
}

// ============================================
// SCORING MODEL CONSTANTS
// ============================================

const BLOCKER_DEDUCTION = 40
const WARNING_DEDUCTION = 10
const MAX_SCORE = 100

// ============================================
// STATUS BANDS
// ============================================

function scoreToStatus(score: number): ReadinessStatus {
  if (score >= 80) return 'READY'
  if (score >= 60) return 'WARNING'
  return 'NOT_READY'
}

// ============================================
// ISSUE CATALOG
// Defined once here so every part of the system uses the same codes/messages.
// ============================================

export const READINESS_ISSUES = {
  // --- Banking ---
  BANKING_NOT_SUBMITTED: (): ReadinessIssue => ({
    code: 'BANKING_NOT_SUBMITTED',
    domain: 'banking',
    level: 'BLOCKER',
    title: 'Banking information not on file',
    description:
      'No banking details have been submitted for this contractor. EFT payment cannot be processed.',
    recommendedAction: 'Request the contractor to submit their banking information via the contractor portal, or add it manually from the contractor profile.',
    overridable: false,
  }),
  BANKING_PENDING_REVIEW: (): ReadinessIssue => ({
    code: 'BANKING_PENDING_REVIEW',
    domain: 'banking',
    level: 'BLOCKER',
    title: 'Banking information pending review',
    description:
      'Banking details have been submitted but have not yet been reviewed and approved by an accountant or admin.',
    recommendedAction: 'Review and approve the contractor\'s banking information from the Banking Changes tab.',
    overridable: false,
  }),
  BANKING_REJECTED: (): ReadinessIssue => ({
    code: 'BANKING_REJECTED',
    domain: 'banking',
    level: 'BLOCKER',
    title: 'Banking information rejected',
    description:
      'The submitted banking details were reviewed and rejected. A new submission is required before payment can proceed.',
    recommendedAction: 'Contact the contractor and request a corrected banking submission.',
    overridable: false,
  }),
  BANKING_CHANGE_PENDING: (): ReadinessIssue => ({
    code: 'BANKING_CHANGE_PENDING',
    domain: 'banking',
    level: 'BLOCKER',
    title: 'Banking change request pending',
    description:
      'The contractor has submitted a new banking change request that is awaiting review. Payment is held until the change is reviewed to prevent fraud.',
    recommendedAction: 'Review the pending banking change request from the Banking Changes tab before processing payment.',
    overridable: false,
  }),
  BANKING_NO_ENCRYPTED_DATA: (): ReadinessIssue => ({
    code: 'BANKING_NO_ENCRYPTED_DATA',
    domain: 'banking',
    level: 'BLOCKER',
    title: 'Banking account details missing',
    description:
      'The banking profile is marked as approved but the encrypted account data is missing. This indicates incomplete onboarding.',
    recommendedAction: 'Contact support or re-enter the contractor\'s banking details.',
    overridable: false,
  }),

  // --- Compliance ---
  WCB_EXPIRED: (): ReadinessIssue => ({
    code: 'WCB_EXPIRED',
    domain: 'compliance',
    level: 'BLOCKER',
    title: 'WCB Clearance expired',
    description:
      'The contractor\'s WCB (Workers\' Compensation Board) clearance certificate has expired. Payment is blocked until a valid clearance is on file.',
    recommendedAction: 'Request an updated WCB clearance letter from the contractor and upload it to their compliance profile. An Admin or Accountant may issue a time-limited override with a documented reason.',
    // BUG-003 fix: WCB can be overridden by Admin/Accountant with documented reason,
    // expiry date, and full audit log — identical to all other compliance overrides.
    overridable: true,
  }),
  WCB_EXPIRING_SOON: (): ReadinessIssue => ({
    code: 'WCB_EXPIRING_SOON',
    domain: 'compliance',
    level: 'WARNING',
    title: 'WCB Clearance expiring within 30 days',
    description:
      'The contractor\'s WCB clearance will expire soon. Payment can proceed but a renewal should be requested.',
    recommendedAction: 'Request an updated WCB clearance from the contractor before the current one expires.',
    overridable: true,
  }),
  WCB_NOT_ON_FILE: (): ReadinessIssue => ({
    code: 'WCB_NOT_ON_FILE',
    domain: 'compliance',
    level: 'BLOCKER',
    title: 'WCB Clearance not on file',
    description:
      'No WCB clearance certificate is on file for this contractor. WCB verification is required before payment.',
    recommendedAction: 'Request the contractor\'s current WCB clearance certificate and upload it to their compliance profile. An Admin or Accountant may issue a time-limited override with a documented reason.',
    // BUG-003 fix: WCB missing/expired can be overridden by Admin/Accountant only.
    // Override still requires 25+ char reason, expiry date, and audit log.
    overridable: true,
  }),
  INSURANCE_EXPIRED: (): ReadinessIssue => ({
    code: 'INSURANCE_EXPIRED',
    domain: 'compliance',
    level: 'BLOCKER',
    title: 'Insurance certificate expired',
    description:
      'The contractor\'s certificate of insurance has expired. Payment is blocked until a valid policy is on file.',
    recommendedAction: 'Request an updated certificate of insurance from the contractor.',
    overridable: false,
  }),
  INSURANCE_EXPIRING_SOON: (): ReadinessIssue => ({
    code: 'INSURANCE_EXPIRING_SOON',
    domain: 'compliance',
    level: 'WARNING',
    title: 'Insurance expiring within 30 days',
    description:
      'The contractor\'s insurance certificate will expire soon. Payment can proceed, but a renewal should be requested.',
    recommendedAction: 'Request an updated certificate of insurance before the current one expires.',
    overridable: true,
  }),
  INSURANCE_NOT_ON_FILE: (): ReadinessIssue => ({
    code: 'INSURANCE_NOT_ON_FILE',
    domain: 'compliance',
    level: 'BLOCKER',
    title: 'Insurance certificate not on file',
    description:
      'No insurance certificate has been submitted for this contractor. A valid certificate of insurance is required before payment.',
    recommendedAction: 'Request a certificate of insurance from the contractor and upload it to their compliance profile.',
    overridable: true,
  }),

  // --- Business License ---
  BUSINESS_LICENSE_EXPIRED: (): ReadinessIssue => ({
    code: 'BUSINESS_LICENSE_EXPIRED',
    domain: 'compliance',
    level: 'BLOCKER',
    title: 'Business license expired',
    description:
      'The contractor\'s business or trade license has expired. Payment is blocked until a valid license is on file.',
    recommendedAction: 'Request an updated business license from the contractor and upload it to their compliance profile.',
    overridable: true,
  }),
  BUSINESS_LICENSE_EXPIRING_SOON: (): ReadinessIssue => ({
    code: 'BUSINESS_LICENSE_EXPIRING_SOON',
    domain: 'compliance',
    level: 'WARNING',
    title: 'Business license expiring within 30 days',
    description:
      'The contractor\'s business license will expire soon. Payment can proceed, but a renewal should be requested.',
    recommendedAction: 'Request a renewed business license from the contractor before the current one expires.',
    overridable: true,
  }),
  BUSINESS_LICENSE_NOT_ON_FILE: (): ReadinessIssue => ({
    code: 'BUSINESS_LICENSE_NOT_ON_FILE',
    domain: 'compliance',
    level: 'BLOCKER',
    title: 'Business license not on file',
    description:
      'No business or trade license has been submitted for this contractor. A valid license is required before payment.',
    recommendedAction: 'Request the contractor\'s business license and upload it to their compliance profile.',
    overridable: true,
  }),

  // --- Safety Certification ---
  SAFETY_CERT_EXPIRED: (): ReadinessIssue => ({
    code: 'SAFETY_CERT_EXPIRED',
    domain: 'compliance',
    level: 'BLOCKER',
    title: 'Safety certification expired',
    description:
      'The contractor\'s required safety certification has expired. Payment is blocked until a valid certification is on file.',
    recommendedAction: 'Request an updated safety certification from the contractor and upload it to their compliance profile.',
    overridable: true,
  }),
  SAFETY_CERT_EXPIRING_SOON: (): ReadinessIssue => ({
    code: 'SAFETY_CERT_EXPIRING_SOON',
    domain: 'compliance',
    level: 'WARNING',
    title: 'Safety certification expiring within 30 days',
    description:
      'The contractor\'s safety certification will expire soon. Payment can proceed, but a renewal should be requested.',
    recommendedAction: 'Request a renewed safety certification from the contractor before the current one expires.',
    overridable: true,
  }),
  SAFETY_CERT_NOT_ON_FILE: (): ReadinessIssue => ({
    code: 'SAFETY_CERT_NOT_ON_FILE',
    domain: 'compliance',
    level: 'BLOCKER',
    title: 'Safety certification not on file',
    description:
      'No safety certification has been submitted for this contractor. A valid certification is required by your system settings before payment.',
    recommendedAction: 'Request the contractor\'s safety certification and upload it to their compliance profile.',
    overridable: true,
  }),

  // --- Lien Waiver ---
  LIEN_WAIVER_MISSING: (): ReadinessIssue => ({
    code: 'LIEN_WAIVER_MISSING',
    domain: 'compliance',
    level: 'BLOCKER',
    title: 'Lien waiver not on file',
    description:
      'No lien waiver has been received for this invoice. A signed lien waiver is required before releasing payment.',
    recommendedAction: 'Request a signed lien waiver from the contractor before processing payment.',
    overridable: true,
  }),
  LIEN_WAIVER_UNSIGNED: (): ReadinessIssue => ({
    code: 'LIEN_WAIVER_UNSIGNED',
    domain: 'compliance',
    level: 'BLOCKER',
    title: 'Lien waiver not signed',
    description:
      'A lien waiver exists for this invoice but has not yet been signed by the contractor. Payment is held until the waiver is signed.',
    recommendedAction: 'Contact the contractor and request they sign the lien waiver via their portal.',
    overridable: true,
  }),
  LIEN_WAIVER_EXPIRED: (): ReadinessIssue => ({
    code: 'LIEN_WAIVER_EXPIRED',
    domain: 'compliance',
    level: 'BLOCKER',
    title: 'Lien waiver has expired',
    description:
      'The lien waiver on file for this invoice has passed its valid-through date. A new waiver must be obtained before payment.',
    recommendedAction: 'Request a new lien waiver from the contractor and have them sign it before processing payment.',
    overridable: true,
  }),

  // --- Holdback ---
  HOLDBACK_RECORD_MISSING: (): ReadinessIssue => ({
    code: 'HOLDBACK_RECORD_MISSING',
    domain: 'holdback',
    level: 'WARNING',
    title: 'Holdback ledger record missing',
    description:
      'This invoice includes a holdback deduction, but no corresponding holdback ledger entry was created. The holdback may not be tracked for release.',
    recommendedAction: 'Review the holdback ledger and create a ledger record for this invoice.',
    overridable: true,
  }),

  // --- Approval ---
  APPROVAL_LIMIT_EXCEEDED: (): ReadinessIssue => ({
    code: 'APPROVAL_LIMIT_EXCEEDED',
    domain: 'approval',
    level: 'WARNING',
    title: 'Approval limit may have been exceeded',
    description:
      'This invoice was approved by a PM whose approval limit is lower than the invoice total. An admin or accountant should confirm this approval is authorized.',
    recommendedAction: 'Verify with an admin that this invoice has been appropriately authorized before processing payment.',
    overridable: true,
  }),

  // --- Invoice state ---
  INVOICE_NOT_APPROVED: (): ReadinessIssue => ({
    code: 'INVOICE_NOT_APPROVED',
    domain: 'invoice_state',
    level: 'BLOCKER',
    title: 'Invoice not yet approved',
    description:
      'This invoice has not been approved by a PM or admin. Payment cannot be processed until the invoice is in Approved status.',
    recommendedAction: 'Route this invoice to the assigned PM for review and approval.',
    overridable: false,
  }),
  INVOICE_ALREADY_PAID: (): ReadinessIssue => ({
    code: 'INVOICE_ALREADY_PAID',
    domain: 'invoice_state',
    level: 'INFO',
    title: 'Invoice already paid',
    description: 'This invoice has already been fully paid. No further payment action is required.',
    recommendedAction: 'Review the payment history for this invoice.',
    overridable: false,
  }),
  UNPAID_CERTIFICATES_EXIST: (): ReadinessIssue => ({
    code: 'UNPAID_CERTIFICATES_EXIST',
    domain: 'invoice_state',
    level: 'BLOCKER',
    title: 'Unpaid payment certificates exist',
    description:
      'This invoice uses certificate-based payment and has one or more unpaid payment certificates. Certificates must be paid before the invoice balance can be settled directly.',
    recommendedAction: 'Pay the outstanding payment certificates from the Payments tab before processing the invoice balance.',
    overridable: false,
  }),
} as const

// ============================================
// ENGINE: evaluateReadiness()
//
// Pure function. No I/O. Takes a ReadinessInput and returns a ReadinessReport.
// ============================================

export function evaluateReadiness(input: ReadinessInput): ReadinessReport {
  const issues: ReadinessIssue[] = []
  const now = new Date()

  // ------------------------------------------
  // 1. INVOICE STATE CHECKS
  // ------------------------------------------

  if (input.invoiceStatus === 'paid') {
    issues.push(READINESS_ISSUES.INVOICE_ALREADY_PAID())
  } else if (
    // BUG-FIX (Issue C): 'payment_processing' was missing from the allowed list.
    // executeEFTPayment accepts invoices in either 'approved' or 'payment_processing'
    // status, so showing INVOICE_NOT_APPROVED for payment_processing was a false
    // positive that confused accountants reviewing in-flight batches.
    !['approved', 'payment_processing', 'payment_initiated', 'partially_paid'].includes(
      input.invoiceStatus
    )
  ) {
    issues.push(READINESS_ISSUES.INVOICE_NOT_APPROVED())
  }

  // Skip this check when paying a certificate: the certificate's own 'approved'
  // status would trigger a self-blocking loop. Direct invoice payments (isCertificatePayment
  // is false/undefined) are still hard-blocked if any certificate is unpaid.
  if (input.hasUnpaidCertificates && input.invoiceStatus === 'approved' && !input.isCertificatePayment) {
    issues.push(READINESS_ISSUES.UNPAID_CERTIFICATES_EXIST())
  }

  // ------------------------------------------
  // 2. BANKING CHECKS
  // ------------------------------------------

  // Stage 2 will set bankingApprovalStatus from the DB column.
  // Stage 1: we use hasBankingData as a proxy signal.
  if (input.vendorType !== 'supplier') {
    if (input.bankingApprovalStatus !== null) {
      // Stage 2+ path: use the authoritative status column
      switch (input.bankingApprovalStatus) {
        case 'not_submitted':
          issues.push(READINESS_ISSUES.BANKING_NOT_SUBMITTED())
          break
        case 'pending_review':
          issues.push(READINESS_ISSUES.BANKING_PENDING_REVIEW())
          break
        case 'rejected':
          issues.push(READINESS_ISSUES.BANKING_REJECTED())
          break
        case 'approved':
          // Approved — but verify the actual encrypted data is present
          if (!input.hasBankingData) {
            issues.push(READINESS_ISSUES.BANKING_NO_ENCRYPTED_DATA())
          }
          // Even if approved, a pending change request freezes payment
          if (input.hasPendingBankingChangeRequest) {
            issues.push(READINESS_ISSUES.BANKING_CHANGE_PENDING())
          }
          break
        // 'superseded' maps to the same as pending_review (change request in progress)
        case 'superseded':
          issues.push(READINESS_ISSUES.BANKING_CHANGE_PENDING())
          break
      }
    } else {
      // Stage 1 path: bankingApprovalStatus column doesn't exist yet.
      // Use hasBankingData as a proxy — if no encrypted account data, flag as not submitted.
      if (!input.hasBankingData) {
        issues.push(READINESS_ISSUES.BANKING_NOT_SUBMITTED())
      } else if (input.hasPendingBankingChangeRequest) {
        issues.push(READINESS_ISSUES.BANKING_CHANGE_PENDING())
      }
    }
  }

  // ------------------------------------------
  // 3. COMPLIANCE CHECKS
  // ------------------------------------------

  if (input.vendorType !== 'supplier') {
  // WCB — hard block if expired (when block_wcb_expired = true)
  if (input.wcbClearanceExpiry === null) {
    if (input.blockWcbExpired) {
      issues.push(READINESS_ISSUES.WCB_NOT_ON_FILE())
    }
  } else {
    const wcbExpiry = new Date(input.wcbClearanceExpiry)
    const daysUntilExpiry = Math.ceil((wcbExpiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    if (daysUntilExpiry < 0) {
      if (input.blockWcbExpired) {
        issues.push(READINESS_ISSUES.WCB_EXPIRED())
      } else {
        issues.push({
          ...READINESS_ISSUES.WCB_EXPIRED(),
          level: 'WARNING',
          overridable: true,
        })
      }
    } else if (daysUntilExpiry <= 30) {
      issues.push(READINESS_ISSUES.WCB_EXPIRING_SOON())
    }
  }

  // Insurance — block if required, warn on expiry, block if not on file when required
  if (input.requireInsurance) {
    if (input.insuranceCertificateExpiry === null) {
      issues.push(READINESS_ISSUES.INSURANCE_NOT_ON_FILE())
    } else {
      const insExpiry = new Date(input.insuranceCertificateExpiry)
      const daysUntilExpiry = Math.ceil((insExpiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      if (daysUntilExpiry < 0) {
        issues.push(READINESS_ISSUES.INSURANCE_EXPIRED())
      } else if (daysUntilExpiry <= 30) {
        issues.push(READINESS_ISSUES.INSURANCE_EXPIRING_SOON())
      }
    }
  } else if (input.insuranceCertificateExpiry !== null) {
    // Insurance not required by settings but IS on file — still warn if it expired
    const insExpiry = new Date(input.insuranceCertificateExpiry)
    const daysUntilExpiry = Math.ceil((insExpiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    if (daysUntilExpiry < 0) {
      issues.push({ ...READINESS_ISSUES.INSURANCE_EXPIRED(), level: 'WARNING', overridable: true })
    } else if (daysUntilExpiry <= 30) {
      issues.push(READINESS_ISSUES.INSURANCE_EXPIRING_SOON())
    }
  }

  // Business license — block when required
  if (input.requireBusinessLicense) {
    if (input.businessLicenseExpiry === null) {
      issues.push(READINESS_ISSUES.BUSINESS_LICENSE_NOT_ON_FILE())
    } else {
      const licExpiry = new Date(input.businessLicenseExpiry)
      const daysUntilExpiry = Math.ceil((licExpiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      if (daysUntilExpiry < 0) {
        issues.push(READINESS_ISSUES.BUSINESS_LICENSE_EXPIRED())
      } else if (daysUntilExpiry <= 30) {
        issues.push(READINESS_ISSUES.BUSINESS_LICENSE_EXPIRING_SOON())
      }
    }
  }

  // Safety certification — block when tenant has it enabled
  if (input.requireSafetyCert) {
    if (input.safetyCertExpiry === null) {
      issues.push(READINESS_ISSUES.SAFETY_CERT_NOT_ON_FILE())
    } else {
      const certExpiry = new Date(input.safetyCertExpiry)
      const daysUntilExpiry = Math.ceil((certExpiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      if (daysUntilExpiry < 0) {
        issues.push(READINESS_ISSUES.SAFETY_CERT_EXPIRED())
      } else if (daysUntilExpiry <= 30) {
        issues.push(READINESS_ISSUES.SAFETY_CERT_EXPIRING_SOON())
      }
    }
  }

  // Lien waiver — nuanced failure reason: missing / unsigned / expired
  // Lien waivers are collected at final invoice settlement, not on individual
  // progress certificate payments. Skip this check when paying a certificate —
  // the waiver will still be enforced when the invoice balance is settled directly.
  if (input.hasSignedLienWaiver === false && input.requireLienWaiver && !input.isCertificatePayment) {
    switch (input.lienWaiverFailureReason) {
      case 'unsigned':
        issues.push(READINESS_ISSUES.LIEN_WAIVER_UNSIGNED())
        break
      case 'expired':
        issues.push(READINESS_ISSUES.LIEN_WAIVER_EXPIRED())
        break
      case 'missing':
      default:
        issues.push(READINESS_ISSUES.LIEN_WAIVER_MISSING())
        break
    }
  }
  }

  // ------------------------------------------
  // 4. HOLDBACK CHECKS
  // ------------------------------------------

  if (input.paidWithoutHoldbackRecord && input.holdbackCents > 0) {
    issues.push(READINESS_ISSUES.HOLDBACK_RECORD_MISSING())
  }

  // ------------------------------------------
  // 5. APPROVAL CHECKS
  // ------------------------------------------

  if (input.approvalLimitExceeded) {
    issues.push(READINESS_ISSUES.APPROVAL_LIMIT_EXCEEDED())
  }

  // ------------------------------------------
  // SCORING
  // ------------------------------------------

  const blockers = issues.filter(i => i.level === 'BLOCKER')
  const warnings = issues.filter(i => i.level === 'WARNING')

  const score = Math.max(
    0,
    MAX_SCORE
      - blockers.length * BLOCKER_DEDUCTION
      - warnings.length * WARNING_DEDUCTION
  )

  // BUG-005 fix: Any blocker must always produce NOT_READY regardless of numeric
  // score. A single BLOCKER deducts 40 points (score = 60), which previously
  // mapped to WARNING. Now we short-circuit the band check if blockers exist.
  const status: ReadinessStatus = blockers.length > 0 ? 'NOT_READY' : scoreToStatus(score)

  // Sort: BLOCKERs first, then WARNINGs, then INFO
  const levelOrder: Record<ReadinessIssueLevel, number> = { BLOCKER: 0, WARNING: 1, INFO: 2 }
  const sortedIssues = [...issues].sort(
    (a, b) => levelOrder[a.level] - levelOrder[b.level]
  )

  // Recommended next action = first blocker's action, or first warning's action, or null
  const recommendedNextAction =
    blockers[0]?.recommendedAction ??
    warnings[0]?.recommendedAction ??
    null

  // Summary label (used in compact badges)
  let summaryLabel: string
  if (status === 'READY') {
    summaryLabel = 'Ready to Pay'
  } else if (blockers.length === 1) {
    summaryLabel = blockers[0].title
  } else if (blockers.length > 1) {
    summaryLabel = `${blockers.length} blocks`
  } else if (warnings.length === 1) {
    summaryLabel = warnings[0].title
  } else {
    summaryLabel = `${warnings.length} warnings`
  }

  return {
    invoiceId: input.invoiceId,
    status,
    score,
    issues: sortedIssues,
    blockers,
    warnings,
    recommendedNextAction,
    evaluatedAt: now.toISOString(),
    summaryLabel,
  }
}

// ============================================
// CONVENIENCE HELPERS
// ============================================

/** True when the invoice has zero blockers */
export function isReadyToPay(report: ReadinessReport): boolean {
  return report.blockers.length === 0 && report.status !== 'NOT_READY'
}

/** True when the invoice is hard-blocked from payment */
export function isHardBlocked(report: ReadinessReport): boolean {
  return report.blockers.length > 0
}

/** Display color class for the readiness status */
export function readinessStatusColor(status: ReadinessStatus): string {
  switch (status) {
    case 'READY':
      return 'text-success'
    case 'WARNING':
      return 'text-warning'
    case 'NOT_READY':
      return 'text-destructive'
  }
}

/** Badge variant for the readiness status */
export function readinessStatusVariant(status: ReadinessStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'READY':
      return 'default'
    case 'WARNING':
      return 'secondary'
    case 'NOT_READY':
      return 'destructive'
  }
}
