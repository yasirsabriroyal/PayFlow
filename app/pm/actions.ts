'use server'

/**
 * PM Actions - Server Actions for Project Manager
 * 
 * IMPORTANT: contractor_status enum valid values are:
 * - active
 * - inactive  
 * - pending_kyc (NOT "pending")
 * - suspended
 */

import { withPermission } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permissions/constants'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

export async function getPMProjects() {
  return withPermission(PERMISSIONS.PROJECTS.VIEW_PROJECTS, async () => {
    const supabase = getSupabaseAdmin()
    
    const { data: projects, error } = await supabase
      .from('projects')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Get PM projects error:', error)
      return { success: false, projects: [] }
    }

    return { success: true, projects: projects || [] }
  })
}

// Fetches contractors for PM views
export async function getPMContractors() {
  return withPermission(PERMISSIONS.VENDORS.VIEW_VENDORS, async () => {
    const supabase = getSupabaseAdmin()
    
    // CRITICAL: Use only valid contractor_status enum values
    // Valid: active, inactive, pending_kyc, suspended
    // INVALID: "pending" (does not exist in enum)
    const { data: contractors, error } = await supabase
      .from('contractors')
      .select('id, company_name, contact_name, status')
      .in('status', ['active', 'pending_kyc'])

    if (error) {
      console.error('Get contractors error:', error)
      return { success: false, contractors: [] }
    }

    return { success: true, contractors: contractors || [] }
  })
}

export async function getPMInvoices() {
  return withPermission(PERMISSIONS.INVOICES.VIEW_AP_QUEUE, async () => {
    const supabase = getSupabaseAdmin()
    
    const { data: invoices, error } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        project_id,
        total_cents,
        status,
        invoice_date,
        created_at,
        contractor:contractors(company_name),
        project:projects(id, name, project_number)
      `)
      .order('created_at', { ascending: false })
      .limit(10)

    if (error) {
      console.error('Get PM invoices error:', error)
      return { success: false, invoices: [] }
    }

    return { success: true, invoices: invoices || [] }
  })
}

// Alias for backwards compatibility
export const getContractors = getPMContractors

// Type for payment certificate input
// Holdback is applied at the INVOICE level only — certificates cover the full
// certified amount with no per-cert holdback deduction.
export type CreatePaymentCertificateInput = {
  invoice_id: string
  project_id: string
  contractor_id: string
  certified_amount_cents: number
  description?: string
  work_period_start?: string
  work_period_end?: string
}

/**
 * Create a payment certificate as a draft.
 *
 * Business rules:
 * - Holdback is reserved at the invoice level; certificates are issued for the
 *   full certified amount with no holdback deduction (holdback_amount_cents = 0).
 * - Available balance = invoice_total - invoice_holdback - sum_of_all_existing_certs
 * - New cert amount must be <= available balance.
 */
export async function createPaymentCertificate(input: CreatePaymentCertificateInput) {
  return withPermission(PERMISSIONS.INVOICES.APPROVE_INVOICES, async (userData) => {
    const supabase = getSupabaseAdmin()

    // 1. Fetch invoice to snapshot totals and validate it exists
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, invoice_number, total_cents, holdback_cents')
      .eq('id', input.invoice_id)
      .single()

    if (invoiceError || !invoice) {
      return { success: false, error: 'Invoice not found' }
    }

    // 2. Fetch all existing certificates to compute running totals
    const { data: existingCerts, error: certsError } = await supabase
      .from('payment_certificates')
      .select('certified_amount_cents')
      .eq('invoice_id', input.invoice_id)

    if (certsError) {
      console.error('Fetch existing certificates error:', certsError)
      return { success: false, error: 'Failed to check existing certificates' }
    }

    const existingCount = (existingCerts || []).length
    const previousCertifiedCents = (existingCerts || []).reduce(
      (sum, c) => sum + (c.certified_amount_cents || 0),
      0
    )

    // 3. Available = invoice_total - holdback_reserved - previously_certified
    const holdbackCents = invoice.holdback_cents || 0
    const availableCents = invoice.total_cents - holdbackCents - previousCertifiedCents

    // 4. Validate
    if (input.certified_amount_cents <= 0) {
      return { success: false, error: 'Certificate amount must be greater than 0' }
    }

    if (availableCents <= 0) {
      return {
        success: false,
        error: 'Cannot issue certificate: remaining balance does not exceed the holdback amount',
      }
    }

    if (input.certified_amount_cents > availableCents) {
      return {
        success: false,
        error: `Certificate amount exceeds available balance. Available: $${(availableCents / 100).toFixed(2)}`,
      }
    }

    // 5. Generate certificate number (e.g. INV-ABC123-PC01, INV-ABC123-PC02, ...)
    const certificateNumber = `${invoice.invoice_number}-PC${String(existingCount + 1).padStart(2, '0')}`

    // 6. Holdback is at invoice level only — no per-cert holdback deduction
    const remainingAfterThisCents = availableCents - input.certified_amount_cents

    // 7. Insert into payment_certificates as draft
    const { data: certificate, error: insertError } = await supabase
      .from('payment_certificates')
      .insert({
        certificate_number: certificateNumber,
        invoice_id: input.invoice_id,
        contractor_id: input.contractor_id,
        project_id: input.project_id,
        certified_amount_cents: input.certified_amount_cents,
        holdback_amount_cents: 0,
        net_payable_cents: input.certified_amount_cents,
        invoice_total_cents: invoice.total_cents,
        previous_certified_cents: previousCertifiedCents,
        remaining_after_this_cents: remainingAfterThisCents,
        status: 'draft',
        description: input.description || null,
        work_period_start: input.work_period_start || null,
        work_period_end: input.work_period_end || null,
        created_by: userData.id,
      })
      .select()
      .single()

    if (insertError) {
      console.error('Create payment certificate error:', insertError)
      return { success: false, error: insertError.message }
    }

    // 8. Audit log
    await supabase.from('audit_logs').insert({
      action: 'certificate_created',
      entity_type: 'payment_certificate',
      entity_id: certificate.id,
      user_id: userData.id,
      description: `Created payment certificate ${certificateNumber} for $${(input.certified_amount_cents / 100).toFixed(2)}`,
      new_values: {
        certificate_number: certificateNumber,
        certified_amount_cents: input.certified_amount_cents,
        invoice_id: input.invoice_id,
        status: 'draft',
      },
    })

    return { success: true, certificate }
  })
}

/**
 * Submit a draft (or rejected) certificate for accountant approval.
 * Moves status: draft → pending  OR  rejected → pending.
 */
export async function submitCertificate(input: { certificate_id: string }) {
  return withPermission(PERMISSIONS.INVOICES.APPROVE_INVOICES, async (userData) => {
    const supabase = getSupabaseAdmin()

    const { data: cert, error: fetchError } = await supabase
      .from('payment_certificates')
      .select('id, status, certificate_number')
      .eq('id', input.certificate_id)
      .single()

    if (fetchError || !cert) {
      return { success: false, error: 'Certificate not found' }
    }

    if (!['draft', 'rejected'].includes(cert.status)) {
      return {
        success: false,
        error: `Cannot submit certificate with status '${cert.status}'. Only draft or rejected certificates can be submitted.`,
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from('payment_certificates')
      .update({
        status: 'pending',
        submitted_at: new Date().toISOString(),
      })
      .eq('id', input.certificate_id)
      .select()
      .single()

    if (updateError) {
      console.error('Submit certificate error:', updateError)
      return { success: false, error: updateError.message }
    }

    await supabase.from('audit_logs').insert({
      action: 'certificate_submitted',
      entity_type: 'payment_certificate',
      entity_id: input.certificate_id,
      user_id: userData.id,
      description: `Submitted certificate ${cert.certificate_number} for approval`,
      old_values: { status: cert.status },
      new_values: { status: 'pending' },
    })

    return { success: true, certificate: updated }
  })
}

/**
 * Reset a rejected certificate back to draft so the PM can revise and
 * re-submit it. Moves status: rejected → draft.
 * The PM then edits the certificate and calls submitCertificate() again.
 */
export async function resubmitCertificate(input: { certificate_id: string }) {
  return withPermission(PERMISSIONS.INVOICES.APPROVE_INVOICES, async (userData) => {
    const supabase = getSupabaseAdmin()

    const { data: cert, error: fetchError } = await supabase
      .from('payment_certificates')
      .select('id, status, certificate_number')
      .eq('id', input.certificate_id)
      .single()

    if (fetchError || !cert) {
      return { success: false, error: 'Certificate not found' }
    }

    if (cert.status !== 'rejected') {
      return {
        success: false,
        error: `Cannot resubmit certificate with status '${cert.status}'. Only rejected certificates can be resubmitted.`,
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from('payment_certificates')
      .update({ status: 'draft' })
      .eq('id', input.certificate_id)
      .select()
      .single()

    if (updateError) {
      console.error('Resubmit certificate error:', updateError)
      return { success: false, error: updateError.message }
    }

    await supabase.from('audit_logs').insert({
      action: 'certificate_reset_to_draft',
      entity_type: 'payment_certificate',
      entity_id: input.certificate_id,
      user_id: userData.id,
      description: `Reset certificate ${cert.certificate_number} to draft for revision`,
      old_values: { status: 'rejected' },
      new_values: { status: 'draft' },
    })

    return { success: true, certificate: updated }
  })
}

// Get pending approvals (invoices and payment requests awaiting PM approval)
export async function getPendingApprovals() {
  return withPermission(PERMISSIONS.INVOICES.VIEW_AP_QUEUE, async () => {
    const supabase = getSupabaseAdmin()
    
    // Fetch invoices with submitted or pending_approval status
    const { data: invoices, error: invoicesError } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        invoice_date,
        due_date,
        total_cents,
        holdback_cents,
        net_payable_cents,
        status,
        source,
        created_at,
        contractor:contractors(id, company_name),
        project:projects(id, name, project_number, current_budget_cents)
      `)
      .in('status', ['submitted', 'pending_approval'])
      .order('created_at', { ascending: false })

    if (invoicesError) {
      console.error('Get pending invoices error:', invoicesError)
      return { success: false, approvals: [], error: invoicesError.message }
    }

    // Transform invoices into approval format
    const approvals = (invoices || []).map((invoice) => {
      const contractor = invoice.contractor as unknown as { id: string; company_name: string } | null
      const project = invoice.project as unknown as { id: string; name: string; project_number: string; current_budget_cents: number } | null
      
      return {
        id: invoice.id,
        type: 'invoice' as const,
        projectId: project?.id || '',
        projectName: project?.name || 'Unknown Project',
        projectNumber: project?.project_number || '',
        projectBudget: (project?.current_budget_cents || 0) / 100,
        contractor: contractor?.company_name || 'Unknown Contractor',
        contractorId: contractor?.id || '',
        invoiceNumber: invoice.invoice_number,
        amount: invoice.total_cents / 100,
        holdback: (invoice.holdback_cents || 0) / 100,
        netPayable: (invoice.net_payable_cents || invoice.total_cents) / 100,
        description: invoice.source === 'manual' ? 'Payment Certificate' : 'Contractor Invoice',
        submittedDate: invoice.created_at,
        dueDate: invoice.due_date,
        status: invoice.status,
      }
    })

    return { success: true, approvals }
  })
}

// Get approved/paid invoices for PM to view their history
export async function getPMApprovedInvoices() {
  return withPermission(PERMISSIONS.INVOICES.VIEW_AP_QUEUE, async () => {
    const supabase = getSupabaseAdmin()
    
    // Fetch invoices with approved or paid status
    const { data: invoices, error: invoicesError } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        invoice_date,
        due_date,
        total_cents,
        holdback_cents,
        net_payable_cents,
        amount_paid_cents,
        status,
        source,
        created_at,
        updated_at,
        contractor:contractors(id, company_name),
        project:projects(id, name, project_number, current_budget_cents)
      `)
      .in('status', ['approved', 'paid'])
      .order('updated_at', { ascending: false })

    if (invoicesError) {
      console.error('Get approved invoices error:', invoicesError)
      return { success: false, invoices: [], error: invoicesError.message }
    }

    // Transform invoices into a display format
    const transformedInvoices = (invoices || []).map((invoice) => {
      const contractor = invoice.contractor as unknown as { id: string; company_name: string } | null
      const project = invoice.project as unknown as { id: string; name: string; project_number: string; current_budget_cents: number } | null
      
      return {
        id: invoice.id,
        type: 'invoice' as const,
        projectId: project?.id || '',
        projectName: project?.name || 'Unknown Project',
        projectNumber: project?.project_number || '',
        projectBudget: (project?.current_budget_cents || 0) / 100,
        contractor: contractor?.company_name || 'Unknown Contractor',
        contractorId: contractor?.id || '',
        invoiceNumber: invoice.invoice_number,
        amount: invoice.total_cents / 100,
        holdback: (invoice.holdback_cents || 0) / 100,
        netPayable: (invoice.net_payable_cents || invoice.total_cents) / 100,
        amountPaid: (invoice.amount_paid_cents || 0) / 100,
        description: invoice.source === 'manual' ? 'Payment Certificate' : 'Contractor Invoice',
        submittedDate: invoice.created_at,
        approvedDate: invoice.updated_at,
        dueDate: invoice.due_date,
        status: invoice.status,
      }
    })

    return { success: true, invoices: transformedInvoices }
  })
}

// Approve an invoice
export async function approveInvoice(invoiceId: string) {
  return withPermission(PERMISSIONS.INVOICES.APPROVE_INVOICES, async () => {
    const supabase = getSupabaseAdmin()
    
    const { data, error } = await supabase
      .from('invoices')
      .update({ 
        status: 'approved',
        updated_at: new Date().toISOString()
      })
      .eq('id', invoiceId)
      .select()
      .single()

    if (error) {
      console.error('Approve invoice error:', error)
      return { success: false, error: error.message }
    }

    return { success: true, invoice: data }
  })
}

// Reject an invoice
export async function rejectInvoice(invoiceId: string, reason: string) {
  return withPermission(PERMISSIONS.INVOICES.APPROVE_INVOICES, async () => {
    const supabase = getSupabaseAdmin()
    
    const { data, error } = await supabase
      .from('invoices')
      .update({ 
        status: 'rejected',
        rejection_reason: reason,
        updated_at: new Date().toISOString()
      })
      .eq('id', invoiceId)
      .select()
      .single()

    if (error) {
      console.error('Reject invoice error:', error)
      return { success: false, error: error.message }
    }

    return { success: true, invoice: data }
  })
}

// Create a new invoice (PM manual entry)
export async function createPMInvoice(input: {
  project_id: string
  contractor_id: string
  total_cents: number
  holdback_percentage: number
  description?: string
  notes?: string
}) {
  return withPermission(PERMISSIONS.INVOICES.CREATE_INVOICE, async (userData) => {
    const supabase = getSupabaseAdmin()
    
    // Validation
    if (!input.project_id) {
      return { success: false, error: 'Project is required' }
    }
    if (!input.contractor_id) {
      return { success: false, error: 'Contractor is required' }
    }
    if (input.total_cents <= 0) {
      return { success: false, error: 'Invoice total must be greater than 0' }
    }
    
    // Calculate holdback and net payable
    const holdbackRate = (input.holdback_percentage || 0) / 100
    const holdbackCents = Math.round(input.total_cents * holdbackRate)
    const netPayableCents = input.total_cents - holdbackCents
    
    // Generate invoice number
    const timestamp = Date.now().toString(36).toUpperCase()
    const random = Math.random().toString(36).substring(2, 6).toUpperCase()
    const invoiceNumber = `INV-${timestamp}-${random}`
    
    // Create the invoice
    const { data, error } = await supabase
      .from('invoices')
      .insert({
        invoice_number: invoiceNumber,
        project_id: input.project_id,
        contractor_id: input.contractor_id,
        subtotal_cents: input.total_cents,
        total_cents: input.total_cents,
        holdback_cents: holdbackCents,
        holdback_percent: input.holdback_percentage || 0,
        net_payable_cents: netPayableCents,
        source: 'manual',
        status: 'submitted',
        invoice_date: new Date().toISOString().split('T')[0],
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days from now
        total_certified_cents: 0,
        total_paid_cents: 0,
        amount_remaining_cents: netPayableCents,
        amount_paid_cents: 0,
      })
      .select()
      .single()
    
    if (error) {
      console.error('Create invoice error:', error)
      return { success: false, error: error.message }
    }
    
    // Log the action
    await supabase.from('audit_logs').insert({
      action: 'invoice_created',
      entity_type: 'invoice',
      entity_id: data.id,
      user_id: userData.id,
      description: `Created invoice ${invoiceNumber} for $${(input.total_cents / 100).toFixed(2)}`,
      new_values: {
        invoice_number: invoiceNumber,
        total_cents: input.total_cents,
        holdback_cents: holdbackCents,
        net_payable_cents: netPayableCents,
      },
    })
    
    return { success: true, invoice: data }
  })
}

/**
 * Get detailed contractor profile for PM view
 * Includes financial summary, projects, invoices, and payments
 */
export async function getPMContractorById(contractorId: string) {
  return withPermission(PERMISSIONS.VENDORS.VIEW_VENDORS, async () => {
    const supabase = getSupabaseAdmin()
    
    // Fetch contractor details
    const { data: contractor, error: contractorError } = await supabase
      .from('contractors')
      .select(`
        id,
        company_name,
        contact_name,
        email,
        phone,
        status,
        address_line1,
        address_line2,
        city,
        province,
        postal_code,
        business_number,
        is_corporation,
        wcb_clearance_expiry,
        notes,
        created_at
      `)
      .eq('id', contractorId)
      .single()
    
    if (contractorError || !contractor) {
      console.error('Get contractor error:', contractorError)
      return { success: false, error: 'Contractor not found' }
    }
    
    // Fetch invoices for this contractor
    const { data: invoices, error: invoicesError } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        total_cents,
        holdback_cents,
        net_payable_cents,
        total_certified_cents,
        total_paid_cents,
        status,
        invoice_date,
        created_at,
        project:projects(id, name, project_number)
      `)
      .eq('contractor_id', contractorId)
      .order('created_at', { ascending: false })
    
    if (invoicesError) {
      console.error('Get contractor invoices error:', invoicesError)
    }
    
    // Fetch projects this contractor is associated with (via invoices)
    const projectIds = [...new Set((invoices || []).map(inv => (inv.project as unknown as { id: string } | null)?.id).filter(Boolean))]
    
    const { data: projects, error: projectsError } = await supabase
      .from('projects')
      .select(`
        id,
        name,
        project_number,
        is_active,
        start_date,
        estimated_completion_date,
        current_budget_cents,
        spent_cents
      `)
      .in('id', projectIds.length > 0 ? projectIds : ['00000000-0000-0000-0000-000000000000'])
      .order('created_at', { ascending: false })
    
    if (projectsError) {
      console.error('Get contractor projects error:', projectsError)
    }
    
    // Fetch payments to this contractor
    const { data: payments, error: paymentsError } = await supabase
      .from('payments')
      .select(`
        id,
        amount_cents,
        payment_method,
        payment_date,
        status,
        created_at
      `)
      .eq('contractor_id', contractorId)
      .order('created_at', { ascending: false })
      .limit(20)
    
    if (paymentsError) {
      console.error('Get contractor payments error:', paymentsError)
    }
    
    // Fetch payment certificates
    const { data: certificates, error: certsError } = await supabase
      .from('payment_certificates')
      .select(`
        id,
        certificate_number,
        certified_amount_cents,
        holdback_amount_cents,
        net_payable_cents,
        status,
        created_at,
        invoice:invoices(invoice_number)
      `)
      .eq('contractor_id', contractorId)
      .order('created_at', { ascending: false })
      .limit(20)
    
    if (certsError) {
      console.error('Get contractor certificates error:', certsError)
    }
    
    // Fetch KYC/compliance documents
    const { data: documents, error: docsError } = await supabase
      .from('vendor_kyc_documents')
      .select(`
        id,
        document_type,
        file_name,
        status,
        expiry_date,
        uploaded_at,
        verified_at
      `)
      .eq('contractor_id', contractorId)
      .order('uploaded_at', { ascending: false })
    
    if (docsError) {
      console.error('Get contractor documents error:', docsError)
    }
    
    // Calculate financial summary
    const invoicesList = invoices || []
    const paymentsList = payments || []
    
    const financialSummary = {
      totalInvoiced: invoicesList.reduce((sum, inv) => sum + (inv.total_cents || 0), 0),
      totalCertified: invoicesList.reduce((sum, inv) => sum + (inv.total_certified_cents || 0), 0),
      totalPaid: paymentsList.filter(p => p.status === 'completed').reduce((sum, p) => sum + (p.amount_cents || 0), 0),
      totalHoldback: invoicesList.reduce((sum, inv) => sum + (inv.holdback_cents || 0), 0),
      pendingPayment: invoicesList
        .filter(inv => ['approved', 'pending_approval'].includes(inv.status))
        .reduce((sum, inv) => sum + (inv.net_payable_cents || 0), 0),
      invoiceCount: invoicesList.length,
      projectCount: (projects || []).length,
    }
    
    return {
      success: true,
      contractor,
      invoices: invoicesList,
      projects: projects || [],
      payments: paymentsList,
      certificates: certificates || [],
      documents: documents || [],
      financialSummary,
    }
  })
}
