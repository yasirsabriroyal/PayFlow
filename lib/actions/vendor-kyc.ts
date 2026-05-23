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
        
        status: 'pending_verification'
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
