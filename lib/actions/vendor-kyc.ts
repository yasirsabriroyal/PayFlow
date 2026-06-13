'use server'

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

interface KYCSubmissionData {
  companyName: string
  contactName: string
  email: string
  phone: string
  addressLine1: string
  addressLine2: string
  city: string
  province: string
  postalCode: string
  
  tradeCategory: string
  wcbAccountNumber: string
  wcbExpiryDate: string
  isCorporation: boolean
  businessNumber: string
  
  paymentMethod: string
  bankName: string
  bankTransitNumber: string
  bankInstitutionNumber: string
  bankAccountNumber: string
  t5018Consent: boolean

  voidChequeDocId: string | null
  wcbClearanceDocId: string | null
}

import { put } from '@vercel/blob'

export async function submitVendorKYC(formData: FormData) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { success: false, error: 'Unauthorized' }
    }

    const adminSupabase = getSupabaseAdmin()

    // 1. Update the existing contractor record
    const { data: contractor, error: updateError } = await adminSupabase
      .from('contractors')
      .update({
        company_name: formData.get('companyName') as string,
        contact_name: formData.get('contactName') as string,
        email: formData.get('email') as string,
        phone: formData.get('phone') as string,
        address_line1: formData.get('addressLine1') as string,
        address_line2: formData.get('addressLine2') as string,
        city: formData.get('city') as string,
        province: formData.get('province') as string,
        postal_code: formData.get('postalCode') as string,
        
        business_number: formData.get('businessNumber') as string,
        is_corporation: formData.get('isCorporation') === 'true',
        
        bank_name: formData.get('bankName') as string,
        bank_transit_number: formData.get('bankTransitNumber') as string,
        bank_institution_number: formData.get('bankInstitutionNumber') as string,
        bank_account_number: formData.get('bankAccountNumber') as string,
        
        wcb_account_number: formData.get('wcbAccountNumber') as string,
        wcb_clearance_expiry: formData.get('wcbExpiryDate') as string || null,
        
        status: 'pending_kyc'
      })
      .eq('auth_user_id', user.id)
      .select()
      .single()

    if (updateError || !contractor) {
      console.error('Failed to update contractor profile:', updateError)
      return { success: false, error: 'Failed to update profile' }
    }

    // 2. Upload and link documents
    const uploadFile = async (file: File | null, type: string, expiry?: string) => {
      if (!file || file.size === 0) return;
      
      const timestamp = Date.now();
      const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const pathname = `users/${user.id}/kyc/${timestamp}-${cleanName}`;
      
      const blob = await put(pathname, file, { access: 'private' });
      
      await adminSupabase.from('vendor_kyc_documents').insert({
        contractor_id: contractor.id,
        document_type: type,
        document_url: blob.pathname,
        file_name: file.name,
        file_size_bytes: file.size,
        mime_type: file.type,
        status: 'pending',
        expiry_date: expiry || null
      });
    };

    await uploadFile(formData.get('voidChequeFile') as File, 'void_cheque');
    await uploadFile(formData.get('wcbClearanceFile') as File, 'wcb_clearance', formData.get('wcbExpiryDate') as string);

    return { success: true }
  } catch (err) {
    console.error('KYC submission error:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

import { requireRole } from '@/lib/permissions/protect-route'
import { revalidatePath } from 'next/cache'

const COMPLIANCE_UPLOAD_TYPES = [
  'wcb_clearance',
  'insurance_certificate',
  'business_license',
  'safety_certification',
] as const

/**
 * Contractor self-service upload of a compliance document (insurance, license,
 * safety cert, WCB) with an optional expiry date. Inserts a new pending
 * document for admin verification. Scoped by auth_user_id (IDOR-safe).
 */
export async function uploadComplianceDocument(formData: FormData) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Unauthorized' }

    const documentType = formData.get('documentType') as string
    if (!COMPLIANCE_UPLOAD_TYPES.includes(documentType as (typeof COMPLIANCE_UPLOAD_TYPES)[number])) {
      return { success: false, error: 'Invalid document type' }
    }

    const file = formData.get('file') as File | null
    if (!file || file.size === 0) {
      return { success: false, error: 'A file is required' }
    }

    const admin = getSupabaseAdmin()
    const { data: contractor } = await admin
      .from('contractors')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()

    if (!contractor) return { success: false, error: 'Contractor profile not found' }

    const expiry = (formData.get('expiryDate') as string) || null
    const timestamp = Date.now()
    const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const pathname = `users/${user.id}/compliance/${timestamp}-${cleanName}`
    const blob = await put(pathname, file, { access: 'private' })

    const { error: insertError } = await admin.from('vendor_kyc_documents').insert({
      contractor_id: contractor.id,
      document_type: documentType,
      document_url: blob.pathname,
      file_name: file.name,
      file_size_bytes: file.size,
      mime_type: file.type,
      status: 'pending',
      expiry_date: expiry,
    })

    if (insertError) {
      console.error('uploadComplianceDocument insert error:', insertError)
      return { success: false, error: insertError.message }
    }

    revalidatePath('/vendor/compliance')
    revalidatePath('/vendor/portal')
    return { success: true }
  } catch (err) {
    console.error('uploadComplianceDocument error:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

/**
 * Fetch all pending KYC documents for the admin verification queue.
 * Returns documents joined with their contractor's basic info.
 */
export async function getPendingKycDocuments() {
  await requireRole('admin')
  const admin = getSupabaseAdmin()

  const { data, error } = await admin
    .from('vendor_kyc_documents')
    .select(`
      id,
      contractor_id,
      document_type,
      file_name,
      document_url,
      status,
      uploaded_at,
      expiry_date,
      rejection_reason,
      contractor:contractors(company_name, contact_name, email)
    `)
    .eq('status', 'pending')
    .order('uploaded_at', { ascending: false })

  if (error) {
    console.error('Fetch pending KYC documents error:', error)
    return { success: false, error: error.message, documents: [] }
  }

  return { success: true, documents: data ?? [] }
}

/**
 * Resolve the public.users.id (the FK target for verified_by) from an
 * authenticated user's auth.users id. Returns null if no record exists.
 */
async function resolveAppUserId(authUserId: string): Promise<string | null> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('users')
    .select('id')
    .eq('auth_user_id', authUserId)
    .single()

  if (error || !data) {
    console.error('resolveAppUserId error:', error)
    return null
  }
  return data.id
}

/**
 * Verify a single KYC document. If, after this verification, the contractor has
 * no remaining pending/rejected documents, the contractor is activated.
 */
export async function verifyKycDocument(documentId: string) {
  const admin = getSupabaseAdmin()
  try {
    const user = await requireRole('admin')
    const appUserId = await resolveAppUserId(user.id)

    const { data: doc, error: fetchError } = await admin
      .from('vendor_kyc_documents')
      .select('id, contractor_id, status')
      .eq('id', documentId)
      .single()

    if (fetchError || !doc) {
      return { success: false, error: 'Document not found' }
    }

    const { error: updateError } = await admin
      .from('vendor_kyc_documents')
      .update({
        status: 'verified',
        verified_by: appUserId,
        verified_at: new Date().toISOString(),
        rejection_reason: null,
      })
      .eq('id', documentId)

    if (updateError) {
      console.error('Verify KYC document error:', updateError)
      return { success: false, error: updateError.message }
    }

    const activation = await maybeActivateContractor(doc.contractor_id, user.id)

    revalidatePath('/admin/dashboard')
    revalidatePath('/admin/contractors')

    return { success: true, activated: activation.activated }
  } catch (err) {
    console.error('verifyKycDocument error:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

/**
 * Reject a single KYC document with a reason. The contractor is notified to
 * re-upload. Rejecting keeps the contractor in pending_kyc.
 */
export async function rejectKycDocument(documentId: string, reason: string) {
  const admin = getSupabaseAdmin()
  try {
    const user = await requireRole('admin')

    if (!reason || !reason.trim()) {
      return { success: false, error: 'A rejection reason is required' }
    }

    const appUserId = await resolveAppUserId(user.id)

    const { data: doc, error: fetchError } = await admin
      .from('vendor_kyc_documents')
      .select('id, contractor_id')
      .eq('id', documentId)
      .single()

    if (fetchError || !doc) {
      return { success: false, error: 'Document not found' }
    }

    const { error: updateError } = await admin
      .from('vendor_kyc_documents')
      .update({
        status: 'rejected',
        verified_by: appUserId,
        verified_at: new Date().toISOString(),
        rejection_reason: reason.trim(),
      })
      .eq('id', documentId)

    if (updateError) {
      console.error('Reject KYC document error:', updateError)
      return { success: false, error: updateError.message }
    }

    revalidatePath('/admin/dashboard')
    revalidatePath('/admin/contractors')

    return { success: true }
  } catch (err) {
    console.error('rejectKycDocument error:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

/**
 * Activate a contractor once every one of their KYC documents is verified and
 * at least one document exists. Sets status to 'active' and stamps
 * kyc_completed_at. No-op if any document is still pending or rejected.
 */
async function maybeActivateContractor(contractorId: string, _userId: string) {
  const admin = getSupabaseAdmin()

  const { data: docs, error } = await admin
    .from('vendor_kyc_documents')
    .select('status')
    .eq('contractor_id', contractorId)

  if (error || !docs || docs.length === 0) {
    return { activated: false }
  }

  const allVerified = docs.every((d) => d.status === 'verified')
  if (!allVerified) {
    return { activated: false }
  }

  const { error: updateError } = await admin
    .from('contractors')
    .update({
      status: 'active',
      kyc_completed_at: new Date().toISOString(),
    })
    .eq('id', contractorId)

  if (updateError) {
    console.error('Activate contractor error:', updateError)
    return { activated: false }
  }

  return { activated: true }
}
