'use server'

/**
 * Invoice Hub Actions
 * 
 * Server actions for the unified Invoice Hub page that displays
 * invoice details, payment certificates, payments, and documents.
 */

import { withPermission } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permissions/constants'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

// =====================================================
// TYPES
// =====================================================

export interface InvoiceHubData {
  invoice: {
    id: string
    invoice_number: string
    invoice_date: string
    due_date: string
    subtotal_cents: number
    gst_hst_cents: number
    gst_hst_rate: number
    pst_cents: number
    pst_rate: number
    qst_cents: number
    qst_rate: number
    total_cents: number
    holdback_cents: number
    holdback_percent: number
    net_payable_cents: number
    total_certified_cents: number
    total_paid_cents: number
    status: string
    source: string
    document_url: string | null
    created_at: string
    updated_at: string
    contractor: {
      id: string
      company_name: string
      contact_name: string
      email: string
      phone: string
      address_line1: string
      city: string
      province: string
      postal_code: string
      bank_name: string
      bank_account_number: string
    } | null
    project: {
      id: string
      name: string
      project_number: string
      city: string
      province: string
      current_budget_cents: number
      spent_cents: number
    } | null
  }
  certificates: Array<{
    id: string
    certificate_number: string
    certified_amount_cents: number
    holdback_amount_cents: number
    net_payable_cents: number
    status: string
    description: string | null
    work_period_start: string | null
    work_period_end: string | null
    created_at: string
    approved_at: string | null
    approved_by: string | null
  }>
  payments: Array<{
    id: string
    amount_cents: number
    payment_method: string
    payment_date: string
    status: string
    cheque_number: string | null
    etransfer_reference: string | null
    wire_reference: string | null
    notes: string | null
    created_at: string
  }>
  documents: Array<{
    id: string
    file_name: string
    file_url: string
    file_type: string
    document_type: string
    description: string | null
    entity_type: string
    created_at: string
  }>
  auditLog: Array<{
    id: string
    action: string
    description: string
    user_id: string
    created_at: string
    old_values: Record<string, unknown>
    new_values: Record<string, unknown>
  }>
  summary: {
    total_certified_cents: number
    total_paid_cents: number
    remaining_balance_cents: number
    holdback_held_cents: number
    holdback_released_cents: number
  }
}

// =====================================================
// GET INVOICE HUB DATA
// =====================================================

export async function getInvoiceHub(invoiceId: string) {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_REGEX.test(invoiceId)) {
    return { success: false, error: 'Invalid invoice ID format', data: null }
  }

  return withPermission(PERMISSIONS.INVOICES.VIEW_AP_QUEUE, async () => {
    const supabase = getSupabaseAdmin()
    
    // 1. Fetch invoice with related data
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
        total_certified_cents,
        total_paid_cents,
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
          bank_account_number
        ),
        project:projects(
          id,
          name,
          project_number,
          city,
          province,
          current_budget_cents,
          spent_cents
        )
      `)
      .eq('id', invoiceId)
      .single()

    if (invoiceError) {
      console.error('Get invoice error:', invoiceError)
      return { success: false, error: invoiceError.message, data: null }
    }

    if (!invoice) {
      return { success: false, error: 'Invoice not found', data: null }
    }

    // 2. Fetch payment certificates
    const { data: certificates, error: certError } = await supabase
      .from('payment_certificates')
      .select(`
        id,
        certificate_number,
        certified_amount_cents,
        holdback_amount_cents,
        net_payable_cents,
        status,
        description,
        work_period_start,
        work_period_end,
        created_at,
        approved_at,
        approved_by
      `)
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: false })

    if (certError) {
      console.error('Get certificates error:', certError)
    }

    // 3. Fetch payments linked to certificates for this invoice
    let payments: Array<{
      id: string
      amount_cents: number
      payment_method: string
      payment_date: string
      status: string
      cheque_number: string | null
      etransfer_reference: string | null
      wire_reference: string | null
      notes: string | null
      created_at: string
    }> = []

    if (certificates && certificates.length > 0) {
      const certIds = certificates.map(c => c.id)
      const { data: paymentData, error: paymentError } = await supabase
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
          created_at
        `)
        .in('payment_certificate_id', certIds)
        .order('created_at', { ascending: false })

      if (paymentError) {
        console.error('Get payments error:', paymentError)
      } else {
        payments = paymentData || []
      }
    }

    // Also check for legacy payments linked via payment_request
    const { data: legacyPayments } = await supabase
      .from('payment_requests')
      .select('id')
      .eq('invoice_id', invoiceId)
    
    if (legacyPayments && legacyPayments.length > 0) {
      const prIds = legacyPayments.map(pr => pr.id)
      const { data: legacyPaymentData } = await supabase
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
          created_at
        `)
        .in('payment_request_id', prIds)
        .order('created_at', { ascending: false })
      
      if (legacyPaymentData) {
        // Merge and dedupe
        const existingIds = new Set(payments.map(p => p.id))
        for (const p of legacyPaymentData) {
          if (!existingIds.has(p.id)) {
            payments.push(p)
          }
        }
      }
    }

    // 4. Fetch documents
    const { data: documents, error: docError } = await supabase
      .from('invoice_documents')
      .select(`
        id,
        file_name,
        file_url,
        file_type,
        document_type,
        description,
        entity_type,
        created_at
      `)
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: false })

    if (docError) {
      console.error('Get documents error:', docError)
    }

    // 5. Fetch audit log - include both invoice-level and certificate-level audit entries
    // First, get audit logs for the invoice itself
    const { data: invoiceAuditLogs, error: invoiceAuditError } = await supabase
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
      .eq('entity_id', invoiceId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (invoiceAuditError) {
      console.error('Get invoice audit log error:', invoiceAuditError)
    }

    // Also fetch audit logs for any payment certificates linked to this invoice
    let certificateAuditLogs: typeof invoiceAuditLogs = []
    if (certificates && certificates.length > 0) {
      const certIds = certificates.map(c => c.id)
      const { data: certAuditData, error: certAuditError } = await supabase
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
        .in('entity_id', certIds)
        .order('created_at', { ascending: false })
        .limit(50)

      if (certAuditError) {
        console.error('Get certificate audit log error:', certAuditError)
      } else {
        certificateAuditLogs = certAuditData || []
      }
    }

    // Merge and sort all audit logs by created_at descending
    const allAuditLogs = [...(invoiceAuditLogs || []), ...certificateAuditLogs]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 50)
    
    const auditLog = allAuditLogs

    // 6. Calculate summary
    // For legacy invoices marked as "paid" but without certificates/payments, use invoice status
    const isPaidStatus = invoice.status === 'paid'
    
    const totalCertifiedFromCerts = certificates?.reduce((sum, c) => 
      sum + (c.status !== 'rejected' && c.status !== 'cancelled' ? c.certified_amount_cents : 0), 0) || 0
    
    const totalPaidFromPayments = payments?.reduce((sum, p) => 
      sum + (p.status === 'completed' ? p.amount_cents : 0), 0) || 0
    
    // Use calculated values from records if they exist, otherwise fallback to stored/legacy values
    const totalCertified = (certificates && certificates.length > 0)
      ? totalCertifiedFromCerts
      : (invoice.total_certified_cents || (isPaidStatus ? invoice.total_cents : 0))
    
    const totalPaid = (payments && payments.length > 0)
      ? totalPaidFromPayments
      : (invoice.total_paid_cents || (isPaidStatus ? invoice.net_payable_cents : 0))

    const remainingBalance = Math.max(0, invoice.total_cents - totalCertified)

    // Holdback calculations
    const holdbackCertified = certificates?.reduce((sum, c) => 
      sum + (c.status !== 'rejected' ? (c.holdback_amount_cents || 0) : 0), 0) || 0

    const summary = {
      total_certified_cents: totalCertified,
      total_paid_cents: totalPaid,
      remaining_balance_cents: remainingBalance,
      holdback_held_cents: holdbackCertified,
      holdback_released_cents: 0, // TODO: Track released holdbacks
    }

    // Transform data to match interface
    const transformedInvoice = {
      ...invoice,
      contractor: invoice.contractor as unknown as InvoiceHubData['invoice']['contractor'],
      project: invoice.project as unknown as InvoiceHubData['invoice']['project'],
    }

    return {
      success: true,
      data: {
        invoice: transformedInvoice,
        certificates: certificates || [],
        payments: payments || [],
        documents: documents || [],
        auditLog: auditLog || [],
        summary,
      } as InvoiceHubData,
    }
  })
}
