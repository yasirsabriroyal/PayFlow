'use server'

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export interface VendorProfile {
  id: string
  companyName: string | null
  contactName: string | null
  email: string | null
  phone: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  province: string | null
  postalCode: string | null
  tradeCategory: string | null
  businessNumber: string | null
  isCorporation: boolean
  preferredPaymentMethod: string | null
  status: string
  // Banking is read-only here; edits go through the banking change-request flow.
  bankName: string | null
  bankAccountLast4: string | null
}

/**
 * Fetch the signed-in contractor's profile. Scoped by auth_user_id (IDOR-safe).
 */
export async function getVendorProfile(): Promise<{ success: boolean; profile: VendorProfile | null }> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, profile: null }

    const admin = getSupabaseAdmin()
    const { data: c, error } = await admin
      .from('contractors')
      .select(
        'id, company_name, contact_name, email, phone, address_line1, address_line2, city, province, postal_code, trade_category, business_number, is_corporation, preferred_payment_method, status, bank_name, bank_account_last4, bank_account_number'
      )
      .eq('auth_user_id', user.id)
      .single()

    if (error || !c) return { success: false, profile: null }

    // Prefer the stored last4 (encrypted-data era); fall back to deriving it
    // from any legacy plaintext that hasn't been backfilled yet.
    const acct = (c.bank_account_number as string) || ''
    const last4 = (c.bank_account_last4 as string) || (acct ? acct.slice(-4) : null)

    return {
      success: true,
      profile: {
        id: c.id as string,
        companyName: (c.company_name as string) ?? null,
        contactName: (c.contact_name as string) ?? null,
        email: (c.email as string) ?? null,
        phone: (c.phone as string) ?? null,
        addressLine1: (c.address_line1 as string) ?? null,
        addressLine2: (c.address_line2 as string) ?? null,
        city: (c.city as string) ?? null,
        province: (c.province as string) ?? null,
        postalCode: (c.postal_code as string) ?? null,
        tradeCategory: (c.trade_category as string) ?? null,
        businessNumber: (c.business_number as string) ?? null,
        isCorporation: Boolean(c.is_corporation),
        preferredPaymentMethod: (c.preferred_payment_method as string) ?? null,
        status: (c.status as string) ?? 'pending_kyc',
        bankName: (c.bank_name as string) ?? null,
        bankAccountLast4: last4,
      },
    }
  } catch (err) {
    console.error('getVendorProfile error:', err)
    return { success: false, profile: null }
  }
}

export interface UpdateVendorProfileInput {
  contactName: string
  phone: string
  addressLine1: string
  addressLine2: string
  city: string
  province: string
  postalCode: string
  tradeCategory: string
  businessNumber: string
  preferredPaymentMethod: string
}

/**
 * Update the signed-in contractor's non-banking profile fields. Banking
 * details are intentionally excluded — those changes require the approval
 * workflow. Scoped by auth_user_id (IDOR-safe).
 */
export async function updateVendorProfile(input: UpdateVendorProfileInput) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Unauthorized' }

    const admin = getSupabaseAdmin()
    const { error } = await admin
      .from('contractors')
      .update({
        contact_name: input.contactName,
        phone: input.phone,
        address_line1: input.addressLine1,
        address_line2: input.addressLine2,
        city: input.city,
        province: input.province,
        postal_code: input.postalCode,
        trade_category: input.tradeCategory || null,
        business_number: input.businessNumber,
        preferred_payment_method: input.preferredPaymentMethod || null,
        updated_at: new Date().toISOString(),
      })
      .eq('auth_user_id', user.id)

    if (error) {
      console.error('updateVendorProfile error:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/vendor/profile')
    revalidatePath('/vendor/portal')
    return { success: true }
  } catch (err) {
    console.error('updateVendorProfile error:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}
