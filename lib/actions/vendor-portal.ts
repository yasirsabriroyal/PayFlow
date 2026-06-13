'use server'

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export type ComplianceDocStatus = 'verified' | 'pending' | 'rejected' | 'expiring' | 'expired' | 'missing'

export interface ComplianceItem {
  documentType: string
  label: string
  status: ComplianceDocStatus
  expiryDate: string | null
  daysUntilExpiry: number | null
  fileName: string | null
  documentId: string | null
}

const COMPLIANCE_DOC_LABELS: Record<string, string> = {
  wcb_clearance: 'WCB Clearance',
  insurance_certificate: 'Insurance Certificate',
  business_license: 'Trade / Business License',
  safety_certification: 'Safety Certification',
  void_cheque: 'Void Cheque',
}

/** Number of days ahead we warn before a document expires. */
export const COMPLIANCE_EXPIRY_LEAD_DAYS = 30

/**
 * Returns the contractor's compliance documents with derived expiry status.
 * Used by the portal compliance card and the compliance center. Scoped by
 * auth_user_id (IDOR-safe).
 */
export async function getContractorCompliance(): Promise<{
  success: boolean
  items: ComplianceItem[]
  bankingOnFile: boolean
}> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, items: [], bankingOnFile: false }

    const admin = getSupabaseAdmin()
    const { data: contractor } = await admin
      .from('contractors')
      .select('id, bank_account_number')
      .eq('auth_user_id', user.id)
      .single()

    if (!contractor) return { success: false, items: [], bankingOnFile: false }

    const { data: docs } = await admin
      .from('vendor_kyc_documents')
      .select('id, document_type, status, expiry_date, file_name, uploaded_at')
      .eq('contractor_id', contractor.id)
      .order('uploaded_at', { ascending: false })

    const now = new Date()
    const trackedTypes = ['wcb_clearance', 'insurance_certificate', 'business_license', 'safety_certification']

    const latestByType = new Map<string, NonNullable<typeof docs>[number]>()
    for (const d of docs || []) {
      if (!latestByType.has(d.document_type)) latestByType.set(d.document_type, d)
    }

    const items: ComplianceItem[] = trackedTypes.map((type) => {
      const doc = latestByType.get(type)
      if (!doc) {
        return {
          documentType: type,
          label: COMPLIANCE_DOC_LABELS[type] || type,
          status: 'missing' as ComplianceDocStatus,
          expiryDate: null,
          daysUntilExpiry: null,
          fileName: null,
          documentId: null,
        }
      }

      let daysUntilExpiry: number | null = null
      if (doc.expiry_date) {
        const expiry = new Date(doc.expiry_date as string)
        daysUntilExpiry = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      }

      let status: ComplianceDocStatus
      if (doc.status === 'rejected') {
        status = 'rejected'
      } else if (doc.status === 'pending') {
        status = 'pending'
      } else if (daysUntilExpiry !== null && daysUntilExpiry < 0) {
        status = 'expired'
      } else if (daysUntilExpiry !== null && daysUntilExpiry <= COMPLIANCE_EXPIRY_LEAD_DAYS) {
        status = 'expiring'
      } else {
        status = 'verified'
      }

      return {
        documentType: type,
        label: COMPLIANCE_DOC_LABELS[type] || type,
        status,
        expiryDate: (doc.expiry_date as string) ?? null,
        daysUntilExpiry,
        fileName: (doc.file_name as string) ?? null,
        documentId: doc.id as string,
      }
    })

    return {
      success: true,
      items,
      bankingOnFile: Boolean(contractor.bank_account_number),
    }
  } catch (err) {
    console.error('getContractorCompliance error:', err)
    return { success: false, items: [], bankingOnFile: false }
  }
}

export async function getVendorPortalStats() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return { success: false, stats: null }

    const adminSupabase = getSupabaseAdmin()

    const { data: contractor } = await adminSupabase
      .from('contractors')
      .select('*')
      .eq('auth_user_id', user.id)
      .single()

    if (!contractor) return { success: false, stats: null }

    // Fetch invoices
    const { data: invoices } = await adminSupabase
      .from('invoices')
      .select('status, total_cents, holdback_cents')
      .eq('contractor_id', contractor.id)

    const pendingReviewCount = (invoices || []).filter(inv => inv.status === 'submitted' || inv.status === 'pending_approval').length
    const approvedCount = (invoices || []).filter(inv => inv.status === 'approved').length

    // Fetch payments for this month
    const currentMonth = new Date()
    currentMonth.setDate(1)
    const { data: payments } = await adminSupabase
      .from('payments')
      .select('amount_cents, payment_date')
      .eq('contractor_id', contractor.id)
      .gte('payment_date', currentMonth.toISOString().split('T')[0])
      
    const paidThisMonthCents = (payments || []).reduce((sum, p) => sum + p.amount_cents, 0)

    // Fetch holdback
    const { data: holdbacks } = await adminSupabase
      .from('holdback_ledgers')
      .select('holdback_amount_cents, released_amount_cents, status')
      .eq('contractor_id', contractor.id)
      
    // Outstanding balance = total withheld minus what has been released
    let holdbackBalanceCents = 0
    if (holdbacks && holdbacks.length > 0) {
      holdbackBalanceCents = holdbacks.reduce((sum, h) => {
        return sum + ((h.holdback_amount_cents || 0) - (h.released_amount_cents || 0))
      }, 0)
    } else {
      // Fallback to summing holdback_cents from invoices if ledger is empty
      holdbackBalanceCents = (invoices || []).reduce((sum, inv) => sum + (inv.holdback_cents || 0), 0)
    }

    return {
      success: true,
      stats: {
        pendingReviewCount,
        approvedCount,
        paidThisMonthCents,
        holdbackBalanceCents,
        wcbStatus: contractor.status === 'active' ? 'Valid' : 'Pending',
        wcbExpiry: contractor.wcb_clearance_expiry || 'N/A'
      }
    }
  } catch (err) {
    console.error('Portal stats error:', err)
    return { success: false, stats: null }
  }
}
