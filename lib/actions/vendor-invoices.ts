'use server'

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { put } from '@vercel/blob'

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
    const file = formData.get('file') as File | null

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

    // 2. Upload and link the document
    if (file && file.size > 0) {
      const timestamp = Date.now()
      const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
      const pathname = `users/${user.id}/invoices/${invoice.id}/${timestamp}-${cleanName}`
      
      const blob = await put(pathname, file, { access: 'private' })
      
      await adminSupabase.from('invoice_documents').insert({
        invoice_id: invoice.id,
        entity_type: 'invoice',
        document_type: 'original_invoice',
        document_url: blob.pathname,
        file_url: blob.pathname,
        file_name: file.name,
        file_size_bytes: file.size,
        file_type: file.type,
        uploaded_by: user.id
      })
    }

    // 3. Log the action
    await adminSupabase.from('audit_logs').insert({
      action: 'invoice_submitted',
      entity_type: 'invoice',
      entity_id: invoice.id,
      user_id: user.id,
      description: `Vendor submitted invoice ${invoiceNumber} for $${(totalCents / 100).toFixed(2)}`,
      new_values: {
        invoice_number: invoiceNumber,
        total_cents: totalCents,
        status: 'submitted'
      },
    })

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
