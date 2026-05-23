'use server'

import { getSupabaseAdmin } from '@/lib/supabase/admin'

/**
 * Completes contractor registration after client-side auth.signUp().
 *
 * Called with the userId returned by signUp. The admin client verifies the
 * user actually exists in Supabase Auth with the supplied email so the
 * userId cannot be spoofed by the client. All DB inserts run server-side
 * and the role is hardcoded — never sourced from user-supplied input.
 */
export async function completeContractorRegistration(input: {
  userId: string
  email: string
  firstName: string
  lastName: string
  companyName: string
  contactName: string
}): Promise<{ success: true } | { success: false; error: string }> {
  const supabase = getSupabaseAdmin()

  // Verify the userId actually belongs to an auth user with this email.
  // Prevents a client from passing an arbitrary userId to claim another
  // user's identity or to insert rows on their behalf.
  const { data: authUser, error: lookupError } = await supabase.auth.admin.getUserById(input.userId)
  if (lookupError || !authUser?.user) {
    return { success: false, error: 'Invalid registration session' }
  }
  if (authUser.user.email !== input.email) {
    return { success: false, error: 'Invalid registration session' }
  }

  const userId = authUser.user.id

  // Contractor record
  const { error: contractorError } = await supabase.from('contractors').insert({
    auth_user_id: userId,
    company_name: input.companyName,
    contact_name: input.contactName,
    email: input.email,
    province: 'ON', // Default required by schema
    status: 'pending_kyc',
  })
  if (contractorError) {
    console.log('[signup] Contractor insert note:', contractorError.message)
  }

  // Users record — role is hardcoded to 'contractor', never user-supplied
  const { error: userError } = await supabase.from('users').insert({
    id: userId,
    auth_user_id: userId,
    email: input.email,
    first_name: input.firstName,
    last_name: input.lastName,
    role: 'contractor',
    is_active: true,
  })
  if (userError) {
    console.log('[signup] User insert note:', userError.message)
  }

  return { success: true }
}
