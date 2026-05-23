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
      .select('id')
      .eq('auth_user_id', user.id)
      .single()

    if (contractorError || !contractor) {
      return { success: false, error: 'Contractor profile not found' }
    }

    const projectId = formData.get('projectId') as string
    const invoiceNumber = formData.get('invoiceNumber') as string
    const totalAmount = parseFloat(formData.get('totalAmount') as string)
    const holdbackAmount = parseFloat(formData.get('holdbackAmount') as string)
    const invoiceDate = formData.get('invoiceDate') as string
    const dueDate = formData.get('dueDate') as string
    const description = formData.get('description') as string
    const file = formData.get('file') as File | null

    if (!projectId || !invoiceNumber || isNaN(totalAmount)) {
      return { success: false, error: 'Missing required fields' }
    }

    // Convert to cents
    const totalCents = Math.round(totalAmount * 100)
    const holdbackCents = Math.round(holdbackAmount * 100)
    const netPayableCents = totalCents - holdbackCents
    const holdbackPercentage = totalCents > 0 ? (holdbackCents / totalCents) * 100 : 0

    // 1. Create the invoice
    const { data: invoice, error: invoiceError } = await adminSupabase
      .from('invoices')
      .insert({
        invoice_number: invoiceNumber,
        project_id: projectId,
        contractor_id: contractor.id,
        subtotal_cents: totalCents,
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
      console.error('Create invoice error:', invoiceError)
      return { success: false, error: 'Failed to create invoice' }
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
    
    // In a real app we would join via project_contractors
    // For now we just return active projects since we're assuming the vendor can see them
    const { data: projects, error } = await adminSupabase
      .from('projects')
      .select('id, name, project_number')
      .eq('is_active', true)

    if (error) {
      return { success: false, projects: [] }
    }

    return { success: true, projects }
  } catch (err) {
    return { success: false, projects: [] }
  }
}
