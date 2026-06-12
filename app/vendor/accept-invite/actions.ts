'use server'

import { getSupabaseAdmin } from '@/lib/supabase/admin'

export interface InvitationDetails {
  valid: boolean
  email?: string
  companyName?: string
  contactName?: string
  error?: string
}

/**
 * Validates a contractor invitation token and returns the associated
 * contractor info for display on the accept-invite page. Read-only.
 */
export async function getContractorInvitation(token: string): Promise<InvitationDetails> {
  if (!token) {
    return { valid: false, error: 'Missing invitation token' }
  }

  const supabase = getSupabaseAdmin()

  const { data: invitation, error } = await supabase
    .from('contractor_invitations')
    .select('id, email, status, expires_at, contractor_id, contractors(company_name, contact_name)')
    .eq('invitation_token', token)
    .maybeSingle()

  if (error || !invitation) {
    return { valid: false, error: 'Invitation not found' }
  }

  if (invitation.status !== 'pending') {
    return { valid: false, error: 'This invitation has already been used or revoked' }
  }

  if (new Date(invitation.expires_at) < new Date()) {
    return { valid: false, error: 'This invitation has expired' }
  }

  const contractor = Array.isArray(invitation.contractors)
    ? invitation.contractors[0]
    : invitation.contractors

  return {
    valid: true,
    email: invitation.email,
    companyName: contractor?.company_name,
    contactName: contractor?.contact_name,
  }
}

/**
 * Accepts a contractor invitation:
 *  1. Re-validates the token (pending + not expired)
 *  2. Creates a Supabase Auth user with the chosen password
 *  3. Links the existing contractor record (auth_user_id)
 *  4. Inserts a `users` row with the hardcoded 'contractor' role
 *  5. Marks the invitation accepted
 *
 * The role is never sourced from client input. All writes run server-side
 * with the admin client.
 */
export async function acceptContractorInvitation(input: {
  token: string
  password: string
  firstName?: string
  lastName?: string
}): Promise<{ success: true; email: string } | { success: false; error: string }> {
  const { token, password } = input

  if (!token) {
    return { success: false, error: 'Missing invitation token' }
  }
  if (!password || password.length < 8) {
    return { success: false, error: 'Password must be at least 8 characters' }
  }

  const supabase = getSupabaseAdmin()

  const { data: invitation, error: inviteError } = await supabase
    .from('contractor_invitations')
    .select('id, email, status, expires_at, contractor_id')
    .eq('invitation_token', token)
    .maybeSingle()

  if (inviteError || !invitation) {
    return { success: false, error: 'Invitation not found' }
  }
  if (invitation.status !== 'pending') {
    return { success: false, error: 'This invitation has already been used or revoked' }
  }
  if (new Date(invitation.expires_at) < new Date()) {
    return { success: false, error: 'This invitation has expired' }
  }

  // Ensure the contractor still exists and is not already linked
  const { data: contractor } = await supabase
    .from('contractors')
    .select('id, company_name, contact_name, auth_user_id')
    .eq('id', invitation.contractor_id)
    .single()

  if (!contractor) {
    return { success: false, error: 'Associated contractor no longer exists' }
  }
  if (contractor.auth_user_id) {
    return { success: false, error: 'This contractor already has a portal login' }
  }

  // Create the auth user (email confirmed so they can log in immediately)
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: invitation.email,
    password,
    email_confirm: true,
  })

  if (authError || !authData?.user) {
    return { success: false, error: authError?.message || 'Failed to create account' }
  }

  const userId = authData.user.id

  // Derive name fallbacks from the contractor contact name
  const contactParts = (contractor.contact_name || '').trim().split(/\s+/)
  const firstName = input.firstName?.trim() || contactParts[0] || contractor.company_name
  const lastName = input.lastName?.trim() || contactParts.slice(1).join(' ') || ''

  // Link the contractor record
  const { error: linkError } = await supabase
    .from('contractors')
    .update({ auth_user_id: userId, updated_at: new Date().toISOString() })
    .eq('id', contractor.id)

  if (linkError) {
    // Roll back the auth user to avoid an orphaned account
    await supabase.auth.admin.deleteUser(userId)
    return { success: false, error: 'Failed to link your account. Please try again.' }
  }

  // Create the users row — role hardcoded to 'contractor'
  const { error: userError } = await supabase.from('users').insert({
    id: userId,
    auth_user_id: userId,
    email: invitation.email,
    first_name: firstName,
    last_name: lastName,
    role: 'contractor',
    is_active: true,
  })

  if (userError) {
    console.error('[accept-invite] User insert error:', userError.message)
  }

  // Mark invitation accepted
  await supabase
    .from('contractor_invitations')
    .update({
      status: 'accepted',
      accepted_at: new Date().toISOString(),
      created_user_id: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', invitation.id)

  return { success: true, email: invitation.email }
}
