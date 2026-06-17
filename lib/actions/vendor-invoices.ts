'use server'

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { del } from '@vercel/blob'
import { applyInvoiceStatusChange } from '@/lib/invoices/status-flow'
import { resolveInternalUserId } from '@/lib/utils/resolve-user'

/**
 * Lightweight getter for the signed-in contractor's account status. Used to
 * gate the "Submit Invoice" page up front: only `active` contractors may
 * invoice, so we surface a clear message instead of letting them fill out the
 * whole form and hit a generic upload error at the end. Scoped by
 * auth_user_id (IDOR-safe).
 */
export async function getContractorAccountStatus(): Promise<{
  success: boolean
  status: 'active' | 'pending_kyc' | 'suspended' | 'inactive' | null
  error?: string
}> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, status: null, error: 'Unauthorized' }

    const adminSupabase = getSupabaseAdmin()
    const { data: contractor, error } = await adminSupabase
      .from('contractors')
      .select('status')
      .eq('auth_user_id', user.id)
      .single()

    if (error || !contractor) {
      return { success: false, status: null, error: 'Contractor profile not found' }
    }
    return { success: true, status: contractor.status }
  } catch (e) {
    console.error('getContractorAccountStatus error:', e)
    return { success: false, status: null, error: 'An unexpected error occurred' }
  }
}

export async function submitVendorInvoice(formData: FormData) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false, error: 'Unauthorized' }
    }

    const adminSupabase = getSupabaseAdmin()

    // Get the contractor record associated with this user
    const { data: contractor, error: contractorError } = await adminSupabase
      .from('contractors')
      .select('id, status, company_name')
      .eq('auth_user_id', user.id)
      .single()

    if (contractorError || !contractor) {
      return { success: false, error: 'Contractor profile not found' }
    }

    // Only fully-verified (active) contractors may submit invoices.
    // pending_kyc / suspended / inactive contractors are blocked server-side.
    if (contractor.status !== 'active') {
      return {
        success: false,
        error:
          'Your account is not active yet. Please complete verification before submitting invoices.',
      }
    }

    const projectId = formData.get('projectId') as string
    const invoiceNumber = formData.get('invoiceNumber') as string
    const totalAmount = parseFloat(formData.get('totalAmount') as string)
    const holdbackAmount = parseFloat(formData.get('holdbackAmount') as string)
    const invoiceDate = formData.get('invoiceDate') as string
    const dueDate = formData.get('dueDate') as string

    // Documents are uploaded directly to Vercel Blob from the browser (to
    // bypass the 1 MB Server Action body limit). The form sends only the
    // resulting metadata as JSON, which we validate and persist below.
    type UploadedDocMeta = {
      pathname: string
      fileName: string
      fileSize: number
      fileType: string
    }
    let uploadedDocs: UploadedDocMeta[] = []
    const documentsRaw = formData.get('documents') as string | null
    if (documentsRaw) {
      try {
        const parsed = JSON.parse(documentsRaw)
        if (Array.isArray(parsed)) {
          uploadedDocs = parsed
            .filter(
              (d): d is UploadedDocMeta =>
                d &&
                typeof d.pathname === 'string' &&
                typeof d.fileName === 'string',
            )
            .map((d) => ({
              pathname: d.pathname,
              fileName: d.fileName,
              fileSize: Number(d.fileSize) || 0,
              fileType: typeof d.fileType === 'string' ? d.fileType : '',
            }))
        }
      } catch {
        return { success: false, error: 'Invalid document metadata' }
      }
    }

    // Optional tax breakdown supplied by the form. Falls back gracefully when absent.
    const subtotalRaw = parseFloat(formData.get('subtotal') as string)
    const gstHstRaw = parseFloat(formData.get('gstHst') as string)
    const pstRaw = parseFloat(formData.get('pst') as string)
    const qstRaw = parseFloat(formData.get('qst') as string)
    const gstHstRate = parseFloat(formData.get('gstHstRate') as string)
    const pstRate = parseFloat(formData.get('pstRate') as string)
    const qstRate = parseFloat(formData.get('qstRate') as string)

    if (!projectId || !invoiceNumber || isNaN(totalAmount)) {
      return { success: false, error: 'Missing required fields' }
    }

    // IDOR guard: confirm this contractor is actually assigned to the project
    // they're submitting against. Because this action uses the service-role
    // client (RLS is bypassed), this check is the enforcement layer.
    const { data: assignment, error: assignmentError } = await adminSupabase
      .from('project_contractors')
      .select('id, status')
      .eq('project_id', projectId)
      .eq('contractor_id', contractor.id)
      .maybeSingle()

    if (assignmentError) {
      console.error('Project assignment lookup error:', assignmentError)
      return { success: false, error: 'Unable to verify project assignment' }
    }

    if (!assignment || assignment.status === 'terminated') {
      return {
        success: false,
        error: 'You are not assigned to this project.',
      }
    }

    // Convert to cents
    const totalCents = Math.round(totalAmount * 100)
    const holdbackCents = Math.round(holdbackAmount * 100)
    const netPayableCents = totalCents - holdbackCents
    const holdbackPercentage = totalCents > 0 ? (holdbackCents / totalCents) * 100 : 0

    // Tax breakdown in cents. When the form provides a subtotal we trust it,
    // otherwise we fall back to treating the full amount as the subtotal so
    // legacy/partial submissions still persist coherently.
    const gstHstCents = !isNaN(gstHstRaw) ? Math.round(gstHstRaw * 100) : 0
    const pstCents = !isNaN(pstRaw) ? Math.round(pstRaw * 100) : 0
    const qstCents = !isNaN(qstRaw) ? Math.round(qstRaw * 100) : 0
    const subtotalCents = !isNaN(subtotalRaw)
      ? Math.round(subtotalRaw * 100)
      : totalCents - gstHstCents - pstCents - qstCents

    // 1. Create the invoice
    const { data: invoice, error: invoiceError } = await adminSupabase
      .from('invoices')
      .insert({
        invoice_number: invoiceNumber,
        project_id: projectId,
        contractor_id: contractor.id,
        subtotal_cents: subtotalCents,
        gst_hst_cents: gstHstCents,
        gst_hst_rate: !isNaN(gstHstRate) ? gstHstRate : 0,
        pst_cents: pstCents,
        pst_rate: !isNaN(pstRate) ? pstRate : 0,
        qst_cents: qstCents,
        qst_rate: !isNaN(qstRate) ? qstRate : 0,
        total_cents: totalCents,
        holdback_cents: holdbackCents,
        holdback_percent: holdbackPercentage,
        net_payable_cents: netPayableCents,
        source: 'vendor_portal',
        status: 'submitted',
        invoice_date: invoiceDate,
        due_date: dueDate,
        total_certified_cents: 0,
        total_paid_cents: 0,
        amount_remaining_cents: netPayableCents,
        amount_paid_cents: 0,
      })
      .select()
      .single()

    if (invoiceError || !invoice) {
      console.error('[v0] Create invoice error:', invoiceError)
      return { success: false, error: invoiceError?.message || 'Failed to create invoice' }
    }

    // 2. Link the already-uploaded documents to the invoice.
    //    The bytes are already in Blob (uploaded client-side); here we only
    //    persist the metadata rows. We MUST check for errors — a silent
    //    failure here previously caused contractors' PDFs to be lost while
    //    still showing a success message.
    if (uploadedDocs.length > 0) {
      const rows = uploadedDocs.map((doc, index) => ({
        invoice_id: invoice.id,
        entity_type: 'invoice',
        // First document is the primary invoice; any extras are supporting.
        document_type: index === 0 ? 'original_invoice' : 'supporting_document',
        file_url: doc.pathname,
        file_name: doc.fileName,
        file_size_bytes: doc.fileSize,
        file_type: doc.fileType,
        // Record the uploader's auth id (works for contractors, who have no
        // public.users row). The legacy uploaded_by FK is left null.
        uploaded_by_auth_id: user.id,
      }))

      const { error: docError } = await adminSupabase
        .from('invoice_documents')
        .insert(rows)

      if (docError) {
        console.error('[v0] Invoice document link error:', docError)
        // Roll back so we never present a submitted invoice that is missing
        // its documents. Remove the orphaned blobs and the invoice row, then
        // surface a real error to the contractor.
        await Promise.allSettled(
          uploadedDocs.map((doc) => del(doc.pathname)),
        )
        await adminSupabase.from('invoices').delete().eq('id', invoice.id)
        return {
          success: false,
          error: 'Failed to attach invoice documents. Please try again.',
        }
      }
    }

    // 3. Move the freshly-created invoice into the review queue via the
    // centralized status engine. This writes the audit log + status history
    // and notifies accountants, admins, and the assigned PM (server-side,
    // using real contact info — not the contractor who just submitted).
    const actorUserId = await resolveInternalUserId(user.id, adminSupabase)
    try {
      await applyInvoiceStatusChange({
        invoiceId: invoice.id,
        newStatus: 'pending_approval',
        actor: {
          userId: actorUserId,
          name: contractor.company_name || 'Contractor',
          role: 'contractor',
          authUserId: user.id,
        },
        reason: `Submitted invoice ${invoiceNumber} for $${(totalCents / 100).toFixed(2)}`,
      })
    } catch (statusErr) {
      // Never fail the submission because of a downstream notification/audit issue.
      console.error('[v0] Invoice submit status transition failed:', statusErr)
    }

    return { success: true, invoice }
  } catch (err) {
    console.error('Invoice submission error:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

export async function getVendorProjects() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return { success: false, projects: [] }

    const adminSupabase = getSupabaseAdmin()

    // Resolve the contractor record for the signed-in user.
    const { data: contractor, error: contractorError } = await adminSupabase
      .from('contractors')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()

    if (contractorError || !contractor) {
      return { success: false, projects: [] }
    }

    // Only return projects this contractor is assigned to via project_contractors.
    const { data: assignments, error: assignError } = await adminSupabase
      .from('project_contractors')
      .select('project:projects(id, name, project_number, is_active)')
      .eq('contractor_id', contractor.id)

    if (assignError) {
      console.error('Get vendor projects error:', assignError)
      return { success: false, projects: [] }
    }

    // Flatten the join relation and keep only active projects, de-duplicated.
    const seen = new Set<string>()
    const projects = (assignments || [])
      .map(a => (Array.isArray(a.project) ? a.project[0] : a.project))
      .filter((p): p is { id: string; name: string; project_number: string; is_active: boolean } =>
        Boolean(p) && p.is_active
      )
      .filter(p => {
        if (seen.has(p.id)) return false
        seen.add(p.id)
        return true
      })
      .map(({ id, name, project_number }) => ({ id, name, project_number }))

    return { success: true, projects }
  } catch (err) {
    console.error('Get vendor projects error:', err)
    return { success: false, projects: [] }
  }
}

export interface VendorInvoiceListItem {
  id: string
  invoiceNumber: string
  projectName: string
  invoiceDate: string | null
  dueDate: string | null
  totalCents: number
  netPayableCents: number
  amountPaidCents: number
  holdbackCents: number
  status: string
}

/**
 * List every invoice belonging to the signed-in contractor, newest first.
 * Scoped by contractor_id so a vendor only ever sees their own invoices.
 */
export async function getVendorInvoices(): Promise<{
  success: boolean
  invoices: VendorInvoiceListItem[]
  error?: string
}> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, invoices: [], error: 'Unauthorized' }

    const adminSupabase = getSupabaseAdmin()

    const { data: contractor } = await adminSupabase
      .from('contractors')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()

    if (!contractor) return { success: false, invoices: [], error: 'Contractor profile not found' }

    const { data: rows, error } = await adminSupabase
      .from('invoices')
      .select(
        'id, invoice_number, invoice_date, due_date, total_cents, net_payable_cents, amount_paid_cents, holdback_cents, status, project:projects(name)',
      )
      .eq('contractor_id', contractor.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[v0] Get vendor invoices error:', error)
      return { success: false, invoices: [], error: error.message }
    }

    const invoices: VendorInvoiceListItem[] = (rows || []).map((r) => {
      const project = Array.isArray(r.project) ? r.project[0] : r.project
      return {
        id: r.id as string,
        invoiceNumber: r.invoice_number as string,
        projectName: (project?.name as string) || 'Unknown Project',
        invoiceDate: (r.invoice_date as string) ?? null,
        dueDate: (r.due_date as string) ?? null,
        totalCents: (r.total_cents as number) ?? 0,
        netPayableCents: (r.net_payable_cents as number) ?? 0,
        amountPaidCents: (r.amount_paid_cents as number) ?? 0,
        holdbackCents: (r.holdback_cents as number) ?? 0,
        status: (r.status as string) ?? 'submitted',
      }
    })

    return { success: true, invoices }
  } catch (err) {
    console.error('Get vendor invoices error:', err)
    return { success: false, invoices: [], error: 'An unexpected error occurred' }
  }
}

export interface VendorInvoiceDocument {
  id: string
  fileName: string
  fileSizeBytes: number | null
  documentType: string
  createdAt: string
}

export interface VendorInvoiceDetail extends VendorInvoiceListItem {
  subtotalCents: number
  gstHstCents: number
  gstHstRate: number
  pstCents: number
  pstRate: number
  qstCents: number
  qstRate: number
  amountRemainingCents: number
  totalCertifiedCents: number
  createdAt: string | null
  documents: VendorInvoiceDocument[]
}

/**
 * Fetch a single invoice with its tax breakdown and attached documents.
 * IDOR guard: the invoice must belong to the signed-in contractor.
 */
export async function getVendorInvoiceDetail(invoiceId: string): Promise<{
  success: boolean
  invoice?: VendorInvoiceDetail
  error?: string
}> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Unauthorized' }

    const adminSupabase = getSupabaseAdmin()

    const { data: contractor } = await adminSupabase
      .from('contractors')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()

    if (!contractor) return { success: false, error: 'Contractor profile not found' }

    const { data: r, error } = await adminSupabase
      .from('invoices')
      .select(
        'id, invoice_number, invoice_date, due_date, total_cents, net_payable_cents, amount_paid_cents, amount_remaining_cents, holdback_cents, subtotal_cents, gst_hst_cents, gst_hst_rate, pst_cents, pst_rate, qst_cents, qst_rate, total_certified_cents, status, created_at, contractor_id, project:projects(name)',
      )
      .eq('id', invoiceId)
      .maybeSingle()

    if (error) {
      console.error('[v0] Get invoice detail error:', error)
      return { success: false, error: error.message }
    }

    // IDOR guard — service-role client bypasses RLS, so enforce ownership here.
    if (!r || r.contractor_id !== contractor.id) {
      return { success: false, error: 'Invoice not found' }
    }

    const { data: docs } = await adminSupabase
      .from('invoice_documents')
      .select('id, file_name, file_size_bytes, document_type, created_at')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: false })

    const project = Array.isArray(r.project) ? r.project[0] : r.project

    const invoice: VendorInvoiceDetail = {
      id: r.id as string,
      invoiceNumber: r.invoice_number as string,
      projectName: (project?.name as string) || 'Unknown Project',
      invoiceDate: (r.invoice_date as string) ?? null,
      dueDate: (r.due_date as string) ?? null,
      totalCents: (r.total_cents as number) ?? 0,
      netPayableCents: (r.net_payable_cents as number) ?? 0,
      amountPaidCents: (r.amount_paid_cents as number) ?? 0,
      holdbackCents: (r.holdback_cents as number) ?? 0,
      status: (r.status as string) ?? 'submitted',
      subtotalCents: (r.subtotal_cents as number) ?? 0,
      gstHstCents: (r.gst_hst_cents as number) ?? 0,
      gstHstRate: Number(r.gst_hst_rate) || 0,
      pstCents: (r.pst_cents as number) ?? 0,
      pstRate: Number(r.pst_rate) || 0,
      qstCents: (r.qst_cents as number) ?? 0,
      qstRate: Number(r.qst_rate) || 0,
      amountRemainingCents: (r.amount_remaining_cents as number) ?? 0,
      totalCertifiedCents: (r.total_certified_cents as number) ?? 0,
      createdAt: (r.created_at as string) ?? null,
      documents: (docs || []).map((d) => ({
        id: d.id as string,
        fileName: d.file_name as string,
        fileSizeBytes: (d.file_size_bytes as number) ?? null,
        documentType: (d.document_type as string) ?? 'document',
        createdAt: d.created_at as string,
      })),
    }

    return { success: true, invoice }
  } catch (err) {
    console.error('Get invoice detail error:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

export interface ProjectTaxRate {
  province: string
  gstHstRate: number
  pstRate: number
  qstRate: number
  usesHst: boolean
  usesQst: boolean
}

/**
 * Resolve the combined Canadian tax rates for a project's province so the
 * vendor invoice form can compute GST/HST + PST/QST from a subtotal.
 */
export async function getProjectTaxRate(
  projectId: string,
): Promise<{ success: boolean; rate?: ProjectTaxRate; error?: string }> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Unauthorized' }

    const adminSupabase = getSupabaseAdmin()

    const { data: project, error: projectError } = await adminSupabase
      .from('projects')
      .select('province')
      .eq('id', projectId)
      .single()

    if (projectError || !project?.province) {
      return { success: false, error: 'Project province not found' }
    }

    const { data: taxRow, error: taxError } = await adminSupabase
      .from('canadian_tax_rates')
      .select('province, gst_rate, hst_rate, pst_rate, qst_rate, uses_hst, uses_qst')
      .eq('province', project.province)
      .maybeSingle()

    if (taxError || !taxRow) {
      return { success: false, error: 'Tax rate not found for province' }
    }

    return {
      success: true,
      rate: {
        province: taxRow.province as string,
        // GST and HST are mutually exclusive per province; combine into one rate.
        gstHstRate: taxRow.uses_hst ? Number(taxRow.hst_rate) : Number(taxRow.gst_rate),
        pstRate: Number(taxRow.pst_rate) || 0,
        qstRate: Number(taxRow.qst_rate) || 0,
        usesHst: Boolean(taxRow.uses_hst),
        usesQst: Boolean(taxRow.uses_qst),
      },
    }
  } catch (err) {
    console.error('Get project tax rate error:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

export interface InvoiceNotificationRecipient {
  name: string
  email?: string
  phone?: string
  contractorName: string
}

/**
 * Resolve the project's actually-assigned project manager so invoice-submitted
 * notifications go to a real person instead of a hardcoded address. Falls back
 * to no recipient (caller can skip notifying) when no PM is assigned.
 */
export async function getInvoiceNotificationRecipient(
  projectId: string,
): Promise<{ success: boolean; recipient?: InvoiceNotificationRecipient; error?: string }> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Unauthorized' }

    const adminSupabase = getSupabaseAdmin()

    // Identify the calling contractor so we can label the notification correctly.
    const { data: contractor } = await adminSupabase
      .from('contractors')
      .select('company_name')
      .eq('auth_user_id', user.id)
      .single()

    const contractorName = contractor?.company_name || 'Vendor'

    // Find the project manager assigned to this project.
    const { data: assignment, error: assignError } = await adminSupabase
      .from('project_assignments')
      .select('user:users(first_name, last_name, email, phone, notification_email, notification_phone)')
      .eq('project_id', projectId)
      .eq('role', 'project_manager')
      .limit(1)
      .maybeSingle()

    if (assignError) {
      console.error('Get PM assignment error:', assignError)
      return { success: false, error: 'Unable to resolve project manager' }
    }

    const pm = assignment?.user
      ? (Array.isArray(assignment.user) ? assignment.user[0] : assignment.user)
      : null

    if (!pm) {
      // No PM assigned — caller should skip notifying rather than emailing a stub.
      return { success: true, recipient: undefined }
    }

    const name = `${pm.first_name || ''} ${pm.last_name || ''}`.trim() || 'Project Manager'

    return {
      success: true,
      recipient: {
        name,
        email: pm.notification_email || pm.email || undefined,
        phone: pm.notification_phone || pm.phone || undefined,
        contractorName,
      },
    }
  } catch (err) {
    console.error('Get invoice notification recipient error:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}
