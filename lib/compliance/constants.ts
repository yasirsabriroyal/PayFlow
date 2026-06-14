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

/** Number of days ahead we warn before a document expires. */
export const COMPLIANCE_EXPIRY_LEAD_DAYS = 30

/** Document types tracked in the compliance center. */
export const COMPLIANCE_TRACKED_TYPES = [
  'wcb_clearance',
  'insurance_certificate',
  'business_license',
  'safety_certification',
] as const
