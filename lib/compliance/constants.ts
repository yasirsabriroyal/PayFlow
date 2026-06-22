// Shared compliance constants + types. Plain module (no "use server") so it can
// export non-function values used by both server actions and route handlers.

export type ComplianceDocStatus =
  | 'verified'
  | 'pending'
  | 'rejected'
  | 'expiring'
  | 'expired'
  | 'missing'

export interface ComplianceItem {
  documentType: string
  label: string
  status: ComplianceDocStatus
  expiryDate: string | null
  daysUntilExpiry: number | null
  fileName: string | null
  documentId: string | null
}

export const COMPLIANCE_DOC_LABELS: Record<string, string> = {
  wcb_clearance: 'WCB Clearance',
  insurance_certificate: 'Insurance Certificate',
  business_license: 'Trade / Business License',
  safety_certification: 'Safety Certification',
  void_cheque: 'Void Cheque',
}

/**
 * Legacy single-threshold constant kept for any callers that haven't migrated.
 * The cron now uses COMPLIANCE_ALERT_STAGES for multi-threshold scanning.
 */
export const COMPLIANCE_EXPIRY_LEAD_DAYS = 30

/**
 * Named alert stages in ascending urgency order.
 * Each key maps to a unique row in compliance_expiry_alerts (deduplicated).
 */
export const COMPLIANCE_ALERT_STAGE_LABELS: Record<string, string> = {
  expiring_30d: 'Expiring in 30 days',
  expiring_14d: 'Expiring in 14 days',
  expiring_7d:  'Expiring in 7 days',
  expiring_1d:  'Expiring today',
  expired:      'Expired',
}

/** Document types tracked in the compliance center. */
export const COMPLIANCE_TRACKED_TYPES = [
  'wcb_clearance',
  'insurance_certificate',
  'business_license',
  'safety_certification',
] as const
