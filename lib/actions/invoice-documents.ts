'use server'

/**
 * Invoice Documents Actions
 * 
 * Server actions for managing documents attached to invoices,
 * payment certificates, and payments.
 */

import { createClient } from '@supabase/supabase-js'
import { withPermission } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permissions/constants'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// =====================================================
// TYPES
// =====================================================

export type DocumentEntityType = 'invoice' | 'payment_certificate' | 'payment'
export type DocumentType = 'original_invoice' | 'supporting_doc' | 'payment_receipt' | 'pm_note' | 'contract' | 'other'

export interface CreateDocumentInput {
  entity_type: DocumentEntityType
  invoice_id?: string
  payment_certificate_id?: string
  payment_id?: string
  document_type: DocumentType
  file_name: string
  file_url: string
  file_type?: string
  file_size_bytes?: number
  description?: string
}

export interface InvoiceDocument {
  id: string
  entity_type: DocumentEntityType
  invoice_id?: string
  payment_certificate_id?: string
  payment_id?: string
  document_type: string
  file_name: string
  file_url: string
  file_type?: string
  file_size_bytes?: number
  description?: string
  uploaded_by: string
  created_at: string
  updated_at: string
}

// =====================================================
// CREATE DOCUMENT
// =====================================================

export async function createInvoiceDocument(input: CreateDocumentInput) {
  return withPermission(PERMISSIONS.INVOICES.UPLOAD_INVOICE_ATTACHMENT, async (userData) => {
    const supabase = getSupabaseAdmin()
    
    // Validate that at least one entity ID is provided
    if (!input.invoice_id && !input.payment_certificate_id && !input.payment_id) {
      return { success: false, error: 'At least one of invoice_id, payment_certificate_id, or payment_id is required' }
    }
    
    // Validate file URL
    if (!input.file_url || !input.file_name) {
      return { success: false, error: 'File URL and name are required' }
    }
    
    // Create the document record
    const { data: document, error: createError } = await supabase
      .from('invoice_documents')
      .insert({
        entity_type: input.entity_type,
        invoice_id: input.invoice_id || null,
        payment_certificate_id: input.payment_certificate_id || null,
        payment_id: input.payment_id || null,
        document_type: input.document_type,
        file_name: input.file_name,
        file_url: input.file_url,
        file_type: input.file_type || null,
        file_size_bytes: input.file_size_bytes || null,
        description: input.description || null,
        uploaded_by: userData.id,
      })
      .select()
      .single()
    
    if (createError) {
      console.error('Create document error:', createError)
      return { success: false, error: createError.message }
    }
    
    // Log the action
    await supabase.from('audit_logs').insert({
      action: 'document_uploaded',
      entity_type: input.entity_type,
      entity_id: input.invoice_id || input.payment_certificate_id || input.payment_id,
      user_id: userData.id,
      description: `Uploaded document: ${input.file_name}`,
      new_values: {
        document_type: input.document_type,
        file_name: input.file_name,
      },
    })
    
    return { success: true, document }
  })
}

// =====================================================
// GET DOCUMENTS FOR INVOICE (includes related certificates and payments)
// =====================================================

export async function getInvoiceDocuments(invoiceId: string) {
  return withPermission(PERMISSIONS.INVOICES.VIEW_AP_QUEUE, async () => {
    const supabase = getSupabaseAdmin()
    
    // Get documents directly linked to invoice
    const { data: invoiceDocuments, error: invoiceError } = await supabase
      .from('invoice_documents')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: false })
    
    if (invoiceError) {
      console.error('Get invoice documents error:', invoiceError)
    }
    
    // Get documents linked to certificates for this invoice
    const { data: certificates } = await supabase
      .from('payment_certificates')
      .select('id')
      .eq('invoice_id', invoiceId)
    
    let certificateDocuments: InvoiceDocument[] = []
    if (certificates && certificates.length > 0) {
      const certIds = certificates.map(c => c.id)
      const { data: certDocs, error: certError } = await supabase
        .from('invoice_documents')
        .select('*')
        .in('payment_certificate_id', certIds)
        .order('created_at', { ascending: false })
      
      if (certError) {
        console.error('Get certificate documents error:', certError)
      }
      certificateDocuments = (certDocs || []) as InvoiceDocument[]
    }
    
    // Get documents linked to payments for this invoice's certificates
    // (payments are linked to certificates, not directly to invoices)
    let paymentDocuments: InvoiceDocument[] = []
    if (certificates && certificates.length > 0) {
      const certIds = certificates.map(c => c.id)
      const { data: payments } = await supabase
        .from('payments')
        .select('id')
        .in('payment_certificate_id', certIds)
      
      if (payments && payments.length > 0) {
        const paymentIds = payments.map(p => p.id)
        const { data: payDocs, error: payError } = await supabase
          .from('invoice_documents')
          .select('*')
          .in('payment_id', paymentIds)
          .order('created_at', { ascending: false })
        
        if (payError) {
          console.error('Get payment documents error:', payError)
        }
        paymentDocuments = (payDocs || []) as InvoiceDocument[]
      }
    }
    
    // Combine all documents, organized by type
    const allDocuments = [
      ...(invoiceDocuments || []),
      ...certificateDocuments,
      ...paymentDocuments,
    ] as InvoiceDocument[]
    
    return { 
      success: true, 
      documents: allDocuments,
      byType: {
        invoiceDocuments: invoiceDocuments || [],
        certificateDocuments,
        paymentDocuments,
      }
    }
  })
}

// =====================================================
// GET DOCUMENTS FOR CERTIFICATE
// =====================================================

export async function getCertificateDocuments(certificateId: string) {
  return withPermission(PERMISSIONS.PAYMENT_CERTIFICATES.VIEW_PAYMENT_HISTORY, async () => {
    const supabase = getSupabaseAdmin()
    
    const { data: documents, error } = await supabase
      .from('invoice_documents')
      .select('*')
      .eq('payment_certificate_id', certificateId)
      .order('created_at', { ascending: false })
    
    if (error) {
      console.error('Get certificate documents error:', error)
      return { success: false, documents: [], error: error.message }
    }
    
    return { success: true, documents: documents || [] }
  })
}

// =====================================================
// GET DOCUMENTS FOR PAYMENT
// =====================================================

export async function getPaymentDocuments(paymentId: string) {
  return withPermission(PERMISSIONS.PAYMENTS.VIEW_PAYMENT_RECORDS, async () => {
    const supabase = getSupabaseAdmin()
    
    const { data: documents, error } = await supabase
      .from('invoice_documents')
      .select('*')
      .eq('payment_id', paymentId)
      .order('created_at', { ascending: false })
    
    if (error) {
      console.error('Get payment documents error:', error)
      return { success: false, documents: [], error: error.message }
    }
    
    return { success: true, documents: documents || [] }
  })
}

// =====================================================
// DELETE DOCUMENT
// =====================================================

export async function deleteInvoiceDocument(documentId: string) {
  return withPermission(PERMISSIONS.INVOICES.UPLOAD_INVOICE_ATTACHMENT, async (userData) => {
    const supabase = getSupabaseAdmin()
    
    // Fetch document to verify ownership
    const { data: document, error: fetchError } = await supabase
      .from('invoice_documents')
      .select('id, file_name, uploaded_by, uploaded_by_auth_id, entity_type, invoice_id, payment_certificate_id, payment_id')
      .eq('id', documentId)
      .single()
    
    if (fetchError || !document) {
      return { success: false, error: 'Document not found' }
    }

    // Check parent invoice status
    if (document.invoice_id) {
      const { data: invoice } = await supabase
        .from('invoices')
        .select('status')
        .eq('id', document.invoice_id)
        .single()

      if (invoice && ['approved', 'partially_paid', 'paid'].includes(invoice.status)) {
        return { success: false, error: 'Cannot delete documents from an approved or paid invoice' }
      }
    }
    
    const isInternalStaff = userData.role === 'admin' || userData.role === 'project_manager' || userData.role === 'accountant'
    const { data: { user: authUser } } = await supabase.auth.getUser()
    const isUploader = document.uploaded_by === userData.id || (authUser && document.uploaded_by_auth_id === authUser.id)

    if (!isInternalStaff && !isUploader) {
      return { success: false, error: 'You can only delete documents you uploaded' }
    }
    
    // Delete the document
    const { error: deleteError } = await supabase
      .from('invoice_documents')
      .delete()
      .eq('id', documentId)
    
    if (deleteError) {
      console.error('Delete document error:', deleteError)
      return { success: false, error: deleteError.message }
    }
    
    // Log the action
    await supabase.from('audit_logs').insert({
      action: 'document_deleted',
      entity_type: document.entity_type,
      entity_id: document.invoice_id || document.payment_certificate_id || document.payment_id,
      user_id: userData.id,
      description: `Deleted document: ${document.file_name}`,
    })
    
    return { success: true, message: 'Document deleted' }
  })
}

// =====================================================
// UPDATE DOCUMENT DESCRIPTION
// =====================================================

export async function updateDocumentDescription(documentId: string, description: string) {
  return withPermission(PERMISSIONS.INVOICES.UPLOAD_INVOICE_ATTACHMENT, async (userData) => {
    const supabase = getSupabaseAdmin()
    
    // Fetch document to verify ownership
    const { data: document, error: fetchError } = await supabase
      .from('invoice_documents')
      .select('id, uploaded_by')
      .eq('id', documentId)
      .single()
    
    if (fetchError || !document) {
      return { success: false, error: 'Document not found' }
    }
    
    // Only uploader can update
    if (document.uploaded_by !== userData.id) {
      return { success: false, error: 'You can only edit documents you uploaded' }
    }
    
    // Update the document
    const { error: updateError } = await supabase
      .from('invoice_documents')
      .update({
        description: description.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId)
    
    if (updateError) {
      console.error('Update document error:', updateError)
      return { success: false, error: updateError.message }
    }
    
    return { success: true, message: 'Document updated' }
  })
}
