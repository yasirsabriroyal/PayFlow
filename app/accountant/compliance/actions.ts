'use server'

/**
 * Accountant Compliance Dashboard Actions
 *
 * Server actions for the /accountant/compliance page.
 * Aggregates compliance status across all contractors for the accountant's view.
 */

import { createClient } from '@/lib/supabase/server'
import { COMPLIANCE_DOC_LABELS, COMPLIANCE_TRACKED_TYPES } from '@/lib/compliance/constants'
import { listComplianceOverrides } from '@/lib/compliance/override-actions'
import type { ComplianceOverride } from '@/lib/compliance/override-actions'

// ============================================
// TYPES
// ============================================

export interface ContractorComplianceRow {
  contractor_id: string
  contractor_name: string
  email: string | null
  documents: ComplianceDashboardDoc[]
  /** Overall compliance status for display */
  status: 'compliant' | 'expiring' | 'blocked'
  blockingIssues: string[]
}

export interface ComplianceDashboardDoc {
  document_type: string
  label: string
  status: 'valid' | 'expiring' | 'expired' | 'missing'
  expiry_date: string | null
  days_until_expiry: number | null
}

export interface ComplianceDashboardSummary {
  totalContractors: number
  compliantCount: number
  expiringCount: number
  blockedCount: number
  missingDocCount: number
  expiringDocCount: number
  activeOverridesCount: number
  blockedPaymentsCount: number
}

export type GetComplianceDashboardResult =
  | {
      success: true
      summary: ComplianceDashboardSummary
      contractors: ContractorComplianceRow[]
      overrides: ComplianceOverride[]
      blockedPayments: BlockedPayment[]
    }
  | { success: false; error: string }

export interface BlockedPayment {
  invoice_id: string
  invoice_number: string
  contractor_id: string
  contractor_name: string
  amount_cents: number
  blocked_at: string
  blocked_reason: string
}

// ============================================
// COMPLIANCE DASHBOARD QUERY
// ============================================

/**
 * Fetches the full compliance dashboard data for the accountant portal.
 * Returns per-contractor compliance status, document details, active overrides,
 * and recently blocked payment attempts.
 */
export async function getComplianceDashboard(): Promise<GetComplianceDashboardResult> {
  const supabase = await createClient()

  const today = new Date()
  const soon = new Date()
  soon.setDate(soon.getDate() + 30)

  // 1. Fetch all active contractors
  const { data: contractors, error: contractorError } = await supabase
    .from('contractors')
    .select('id, company_name, contact_name, email')
    .order('company_name', { ascending: true })

  if (contractorError || !contractors) {
    return { success: false, error: contractorError?.message ?? 'Failed to load contractors.' }
  }

  // 2. Fetch all compliance documents for tracked types
  const contractorIds = contractors.map(c => c.id)

  const { data: docs, error: docsError } = await supabase
    .from('vendor_kyc_documents')
    .select('id, contractor_id, document_type, expiry_date, status')
    .in('contractor_id', contractorIds)
    .in('document_type', COMPLIANCE_TRACKED_TYPES)
    .in('status', ['verified', 'expiring', 'expired', 'rejected'])
    .order('expiry_date', { ascending: false })

  if (docsError) {
    return { success: false, error: docsError.message }
  }

  // 3. Fetch system settings to know which doc types are required
  const { data: settings } = await supabase
    .from('system_settings')
    .select('setting_key, setting_value')
    .in('setting_key', [
      'require_business_license',
      'require_insurance_certificate',
      'require_safety_certification',
      'payment_wcb_block',
    ])

  const settingMap: Record<string, boolean> = {
    wcb_clearance: true,
    insurance_certificate: true,
    business_license: true,
    safety_certification: false,
  }
  for (const s of settings ?? []) {
    const val = typeof s.setting_value === 'object' && s.setting_value !== null
      ? Boolean((s.setting_value as Record<string, unknown>).enabled)
      : s.setting_value === true
    if (s.setting_key === 'require_business_license') settingMap['business_license'] = val
    if (s.setting_key === 'require_insurance_certificate') settingMap['insurance_certificate'] = val
    if (s.setting_key === 'require_safety_certification') settingMap['safety_certification'] = val
    if (s.setting_key === 'payment_wcb_block') settingMap['wcb_clearance'] = val
  }

  // 4. Build a per-contractor document map
  // Most recent approved doc per contractor+type
  const docMap = new Map<string, typeof docs[0]>()
  for (const doc of docs ?? []) {
    const key = `${doc.contractor_id}::${doc.document_type}`
    if (!docMap.has(key)) {
      docMap.set(key, doc)
    }
  }

  // 5. Build contractor rows
  const contractorRows: ContractorComplianceRow[] = contractors.map(contractor => {
    const docRows: ComplianceDashboardDoc[] = COMPLIANCE_TRACKED_TYPES.map(docType => {
      const doc = docMap.get(`${contractor.id}::${docType}`)
      const label = COMPLIANCE_DOC_LABELS[docType] ?? docType

      if (!doc) {
        return { document_type: docType, label, status: 'missing' as const, expiry_date: null, days_until_expiry: null }
      }

      const expiryDate = doc.expiry_date ? new Date(doc.expiry_date) : null
      const daysUntilExpiry = expiryDate
        ? Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
        : null

      let docStatus: ComplianceDashboardDoc['status'] = 'valid'
      if (daysUntilExpiry !== null) {
        if (daysUntilExpiry < 0) docStatus = 'expired'
        else if (daysUntilExpiry <= 30) docStatus = 'expiring'
      }

      return {
        document_type: docType,
        label,
        status: docStatus,
        expiry_date: doc.expiry_date,
        days_until_expiry: daysUntilExpiry,
      }
    })

    // Determine overall contractor compliance status
    const blockingIssues: string[] = []
    for (const doc of docRows) {
      const required = settingMap[doc.document_type] ?? false
      if (!required) continue
      if (doc.status === 'missing') {
        blockingIssues.push(`${doc.label}: Missing`)
      } else if (doc.status === 'expired') {
        blockingIssues.push(`${doc.label}: Expired`)
      }
    }

    const hasExpiring = docRows.some(d => d.status === 'expiring')
    const status: ContractorComplianceRow['status'] =
      blockingIssues.length > 0 ? 'blocked' :
      hasExpiring ? 'expiring' :
      'compliant'

    return {
      contractor_id: contractor.id,
      contractor_name: contractor.company_name || contractor.contact_name || contractor.id,
      email: contractor.email,
      documents: docRows,
      status,
      blockingIssues,
    }
  })

  // 6. Fetch active overrides
  const overridesResult = await listComplianceOverrides({ active_only: true, limit: 50 })
  const overrides = overridesResult.success ? overridesResult.overrides : []

  // 7. Fetch recently blocked payment attempts from audit_logs
  const { data: blockedLogs } = await supabase
    .from('audit_logs')
    .select('entity_id, new_values, created_at, description')
    .eq('action', 'payment_blocked_compliance')
    .order('created_at', { ascending: false })
    .limit(20)

  const blockedPayments: BlockedPayment[] = []
  for (const log of blockedLogs ?? []) {
    const vals = (log.new_values as Record<string, unknown>) ?? {}
    if (!vals.invoice_id) continue

    const contractor = contractors.find(c => c.id === vals.contractor_id)
    blockedPayments.push({
      invoice_id: log.entity_id as string,
      invoice_number: (vals.invoice_number as string) ?? log.entity_id as string,
      contractor_id: (vals.contractor_id as string) ?? '',
      contractor_name: (contractor?.company_name || contractor?.contact_name || (vals.contractor_id as string)) ?? '',
      amount_cents: 0, // Not stored in audit log; would need join
      blocked_at: log.created_at as string,
      blocked_reason: (vals.reason as string) ?? log.description as string ?? '',
    })
  }

  // 8. Compute summary counts
  const compliantCount = contractorRows.filter(c => c.status === 'compliant').length
  const expiringCount = contractorRows.filter(c => c.status === 'expiring').length
  const blockedCount = contractorRows.filter(c => c.status === 'blocked').length
  const missingDocCount = contractorRows.reduce((acc, c) =>
    acc + c.documents.filter(d => d.status === 'missing' && settingMap[d.document_type]).length, 0
  )
  const expiringDocCount = contractorRows.reduce((acc, c) =>
    acc + c.documents.filter(d => d.status === 'expiring').length, 0
  )

  return {
    success: true,
    summary: {
      totalContractors: contractorRows.length,
      compliantCount,
      expiringCount,
      blockedCount,
      missingDocCount,
      expiringDocCount,
      activeOverridesCount: overrides.filter(o => o.is_active).length,
      blockedPaymentsCount: blockedPayments.length,
    },
    contractors: contractorRows,
    overrides,
    blockedPayments,
  }
}
