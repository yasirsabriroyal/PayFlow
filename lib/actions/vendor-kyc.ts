'use server'

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { encrypt, lastFour, isBankEncryptionAvailable } from '@/lib/security/crypto'
import { sendGenericAlert } from '@/lib/notifications/server-dispatch'

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
  tradeSubcategory: string
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

    const bankName = formData.get('bankName') as string
    const bankTransit = formData.get('bankTransitNumber') as string
    const bankInstitution = formData.get('bankInstitutionNumber') as string
    const bankAccount = formData.get('bankAccountNumber') as string

    // Encrypt banking at rest when the key is configured; keep only last-4 in
    // the clear. Falls back to legacy plaintext columns if encryption isn't
    // available yet (pre-key), so onboarding never breaks — a later backfill
    // encrypts and clears those plaintext values.
    const encryptionOn = isBankEncryptionAvailable()
    const bankColumns = encryptionOn
      ? {
          bank_name: bankName,
          bank_account_encrypted: encrypt(bankAccount),
          bank_transit_encrypted: encrypt(bankTransit),
          bank_institution_encrypted: encrypt(bankInstitution),
          bank_account_last4: lastFour(bankAccount),
          bank_account_number: null,
          bank_transit_number: null,
          bank_institution_number: null,
        }
      : {
          bank_name: bankName,
          bank_transit_number: bankTransit,
          bank_institution_number: bankInstitution,
          bank_account_number: bankAccount,
          bank_account_last4: lastFour(bankAccount),
        }

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
        trade_category: (formData.get('tradeCategory') as string) || null,
        trade_subcategory: (formData.get('tradeSubcategory') as string) || null,
        preferred_payment_method: (formData.get('paymentMethod') as string) || null,
        
        ...bankColumns,
        
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

const COMPLIANCE_ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png'] as const
const COMPLIANCE_MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB
// Path prefix the client uploads under (see compliance-documents.tsx). The
// token route mints a scoped token for exactly this prefix and may append a
// random suffix, so the returned pathname always starts with `compliance/`.
const COMPLIANCE_PATH_PREFIX = 'compliance/'

interface SaveComplianceDocumentInput {
  documentType: string
  pathname: string
  fileName: string
  fileSize: number
  fileType: string
  expiryDate?: string | null
}

/**
 * Persist metadata for a contractor compliance document AFTER the file has been
 * uploaded directly to Vercel Blob by the client (via `/api/compliance/upload-token`).
 *
 * This is intentionally lightweight: it receives only the resulting blob
 * pathname plus metadata — never the file bytes — so it is not subject to the
 * 1 MB Server Action body limit. Inserts a `pending` document for admin
 * verification; it never auto-approves. Scoped by auth_user_id (IDOR-safe):
 * the row is always linked to the caller's own contractor record, and the blob
 * path must live under that user's namespace.
 */
export async function saveComplianceDocument(input: SaveComplianceDocumentInput) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Unauthorized' }

    const { documentType, pathname, fileName, fileSize, fileType } = input
    const expiry = input.expiryDate || null

    if (!COMPLIANCE_UPLOAD_TYPES.includes(documentType as (typeof COMPLIANCE_UPLOAD_TYPES)[number])) {
      return { success: false, error: 'Invalid document type' }
    }
    if (!pathname || !fileName) {
      return { success: false, error: 'Upload did not complete. Please try again.' }
    }
    if (!COMPLIANCE_ALLOWED_MIME.includes(fileType as (typeof COMPLIANCE_ALLOWED_MIME)[number])) {
      return { success: false, error: 'Unsupported file type. Use PDF, JPG, or PNG.' }
    }
    if (!fileSize || fileSize <= 0) {
      return { success: false, error: 'File is empty.' }
    }
    if (fileSize > COMPLIANCE_MAX_SIZE_BYTES) {
      return { success: false, error: 'File exceeds the 10 MB limit.' }
    }

    const admin = getSupabaseAdmin()
    const { data: contractor } = await admin
      .from('contractors')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()

    if (!contractor) return { success: false, error: 'Contractor profile not found' }

    // Defense-in-depth: the blob path must match the prefix the client upload
    // token was scoped to. IDOR safety is independently guaranteed because the
    // row below is always linked to the caller's own contractor_id.
    if (!pathname.startsWith(COMPLIANCE_PATH_PREFIX)) {
      return { success: false, error: 'Invalid upload path.' }
    }

    const { error: insertError } = await admin.from('vendor_kyc_documents').insert({
      contractor_id: contractor.id,
      document_type: documentType,
      document_url: pathname,
      file_name: fileName,
      file_size_bytes: fileSize,
      mime_type: fileType,
      status: 'pending',
      expiry_date: expiry,
    })

    if (insertError) {
      console.error('saveComplianceDocument insert error:', insertError)
      return { success: false, error: insertError.message }
    }

    revalidatePath('/vendor/compliance')
    revalidatePath('/vendor/portal')
    return { success: true }
  } catch (err) {
    console.error('saveComplianceDocument error:', err)
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

/** Human-readable labels for document types — never expose internal enum names to contractors. */
const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  wcb_clearance: 'WCB Clearance',
  insurance_certificate: 'Insurance Certificate',
  business_license: 'Business License',
  safety_certification: 'Safety Certification',
  void_cheque: 'Void Cheque',
}

function labelForDocumentType(type: string): string {
  return DOCUMENT_TYPE_LABELS[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Notify a contractor about a compliance document decision. Uses the same
 * `sendGenericAlert` path as banking-changes.ts for consistency. Never throws.
 */
async function notifyContractorDocumentDecision(
  admin: ReturnType<typeof getSupabaseAdmin>,
  contractorId: string,
  title: string,
  body: string,
) {
  try {
    const { data: contractor } = await admin
      .from('contractors')
      .select('auth_user_id, email, phone')
      .eq('id', contractorId)
      .single()

    if (!contractor) return

    let recipientUserId: string | null = null
    if (contractor.auth_user_id) {
      const { data: u } = await admin
        .from('users')
        .select('id')
        .eq('auth_user_id', contractor.auth_user_id)
        .maybeSingle()
      recipientUserId = (u?.id as string) ?? null
    }

    await sendGenericAlert({
      recipientUserId,
      recipient: {
        name: 'Contractor',
        email: (contractor.email as string) ?? undefined,
        phone: (contractor.phone as string) ?? undefined,
        emailEnabled: true,
        smsEnabled: Boolean(contractor.phone),
      },
      type: 'kyc_document_decision',
      title,
      body,
      link: '/vendor/compliance',
    })
  } catch (e) {
    console.error('[vendor-kyc] notifyContractorDocumentDecision error:', e)
  }
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
      .select('id, contractor_id, status, document_type')
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

    // Notify the contractor that their document has been verified.
    const docLabel = labelForDocumentType(doc.document_type as string)
    void notifyContractorDocumentDecision(
      admin,
      doc.contractor_id as string,
      `${docLabel} Verified`,
      `Your ${docLabel} has been reviewed and approved. ${activation.activated ? 'Your account is now fully active — you can submit invoices and receive payments.' : 'Please log in to your portal to check the status of any remaining documents.'}\n\nView your compliance documents at /vendor/compliance.`,
    )

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
      .select('id, contractor_id, document_type')
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

    // Notify the contractor that their document was not accepted and they need
    // to re-upload. Use contractor-friendly language — no internal role terms.
    const docLabel = labelForDocumentType(doc.document_type as string)
    void notifyContractorDocumentDecision(
      admin,
      doc.contractor_id as string,
      `Action Required: ${docLabel} Not Accepted`,
      `Your ${docLabel} could not be accepted.\n\nReason: ${reason.trim()}\n\nPlease log in to your vendor portal and upload a new copy of this document to continue the verification process.`,
    )

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
