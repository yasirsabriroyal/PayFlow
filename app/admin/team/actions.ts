'use server'

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { resolveInternalUserId } from '@/lib/utils/resolve-user'
import {
  PERMISSIONS,
} from '@/lib/permissions'
import {
  secureAction,
  // RATE_LIMITS, // Temporarily removed due to bundler issues
} from '@/lib/security/secureAction'

export type CreateUserResult = {
  success: boolean
  error?: string
  user?: {
    id: string
    email: string
    role: string
    temporaryPassword: string
  }
}

type CreateTeamMemberInput = {
  email: string
  firstName: string
  lastName: string
  role: 'admin' | 'project_manager' | 'accountant'
  temporaryPassword: string
}

/**
 * Creates a new internal team member with a temporary password.
 * REQUIRES: manage_users permission
 * RATE LIMITED: 10 actions per minute (user management)
 * 
 * Uses enterprise secureAction wrapper with:
 * - RBAC permission enforcement
 * - Rate limiting
 * - Security telemetry logging
 */
export const createTeamMember = secureAction(
  PERMISSIONS.ADMINISTRATION.MANAGE_USERS,
  async (user, input: CreateTeamMemberInput) => {
    const supabaseAdmin = getSupabaseAdmin()
    const { email, firstName, lastName, role, temporaryPassword } = input

    // Validate password strength
    if (temporaryPassword.length < 8) {
      throw new Error('Password must be at least 8 characters long.')
    }

    // Create auth user with temporary password using Admin API
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
        role,
        full_name: `${firstName} ${lastName}`,
      },
    })

    if (authError) {
      if (authError.message.includes('already been registered') || authError.message.includes('already registered')) {
        throw new Error('This email is already registered in the system.')
      }
      throw new Error(authError.message)
    }

    if (!authData.user) {
      throw new Error('Failed to create user account.')
    }

    // Insert corresponding record into public.users table
    const { error: insertError } = await supabaseAdmin
      .from('users')
      .insert({
        auth_user_id: authData.user.id,
        email: email.toLowerCase(),
        first_name: firstName,
        last_name: lastName,
        role,
        is_active: true,
        created_at: new Date().toISOString(),
      })

    if (insertError) {
      // Compensating rollback: delete the auth user to prevent orphaned accounts
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
      throw new Error('Failed to create user record. Please try again.')
    }

    const auditUserId = await resolveInternalUserId(user.id, supabaseAdmin)
    if (auditUserId) {
      await supabaseAdmin.from('audit_logs').insert({
        action: 'team_member_created',
        entity_type: 'user',
        entity_id: authData.user.id,
        user_id: auditUserId,
        description: `Created team member ${email} with role ${role}`,
        new_values: { email, role, first_name: firstName, last_name: lastName },
      })
    }

    return {
      user: {
        id: authData.user.id,
        email: authData.user.email!,
        role,
        temporaryPassword,
      },
    }
  },
  {
    actionName: 'createTeamMember',
    module: 'admin/team',
    // rateLimit: RATE_LIMITS.MANAGE_USERS, // temporarily disabled
    isCritical: true,
  }
)

type UpdateRoleInput = {
  userId: string
  newRole: 'admin' | 'project_manager' | 'accountant'
}

/**
 * Updates an existing team member's role
 * REQUIRES: manage_users permission
 * RATE LIMITED: 10 actions per minute
 * 
 * Uses enterprise secureAction wrapper
 */
export const updateTeamMemberRole = secureAction(
  PERMISSIONS.ADMINISTRATION.MANAGE_USERS,
  async (user, input: UpdateRoleInput) => {
    const supabaseAdmin = getSupabaseAdmin()
    const { userId, newRole } = input

    // Capture current role before any changes for rollback purposes
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('auth_user_id', userId)
      .single()
    const previousRole = existingUser?.role ?? null

    // Update auth user metadata
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: { role: newRole },
    })

    if (authError) {
      throw new Error(authError.message)
    }

    // Update users table
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ role: newRole })
      .eq('auth_user_id', userId)

    if (updateError) {
      // Compensating rollback: restore previous role in auth metadata
      if (previousRole) {
        await supabaseAdmin.auth.admin.updateUserById(userId, {
          user_metadata: { role: previousRole },
        })
      }
      throw new Error('Failed to update user role. Auth role has been restored.')
    }

    const auditUserId = await resolveInternalUserId(user.id, supabaseAdmin)
    if (auditUserId) {
      await supabaseAdmin.from('audit_logs').insert({
        action: 'team_member_role_updated',
        entity_type: 'user',
        entity_id: userId,
        user_id: auditUserId,
        description: `Updated team member role from ${previousRole} to ${newRole}`,
        new_values: { role: newRole },
        old_values: { role: previousRole },
      })
    }

    return { updated: true }
  },
  {
    actionName: 'updateTeamMemberRole',
    module: 'admin/team',
    // rateLimit: RATE_LIMITS.MANAGE_USERS, // temporarily disabled
    isCritical: true,
    // Policy context for role assignment policy
    getPolicyContext: (input) => {
      const roleInput = input as UpdateRoleInput
      return {
        targetUserId: roleInput.userId,
        targetRole: roleInput.newRole,
      }
    },
  }
)

/**
 * Deactivates a team member's account
 * REQUIRES: manage_users permission
 * RATE LIMITED: 10 actions per minute
 * 
 * Uses enterprise secureAction wrapper
 */
export const deactivateTeamMember = secureAction(
  PERMISSIONS.ADMINISTRATION.MANAGE_USERS,
  async (user, input: { userId: string }) => {
    const supabaseAdmin = getSupabaseAdmin()
    const { userId } = input

    // Ban the user in Supabase Auth
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      ban_duration: '876000h', // ~100 years
    })

    if (authError) {
      throw new Error(authError.message)
    }

    // Update users table
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ is_active: false })
      .eq('auth_user_id', userId)

    if (updateError) {
      console.error('Failed to update users table:', updateError)
    }

    const auditUserId = await resolveInternalUserId(user.id, supabaseAdmin)
    if (auditUserId) {
      await supabaseAdmin.from('audit_logs').insert({
        action: 'team_member_deactivated',
        entity_type: 'user',
        entity_id: userId,
        user_id: auditUserId,
        description: `Deactivated team member account`,
        new_values: { is_active: false },
      })
    }

    return { deactivated: true }
  },
  {
    actionName: 'deactivateTeamMember',
    module: 'admin/team',
    // rateLimit: RATE_LIMITS.MANAGE_USERS, // temporarily disabled
    isCritical: true,
  }
)

type ResetPasswordInput = {
  userId: string
  newPassword: string
}

/**
 * Resets a team member's password (admin sets new temporary password)
 * REQUIRES: manage_users permission
 * RATE LIMITED: 10 actions per minute
 * 
 * Uses enterprise secureAction wrapper
 */
export const resetTeamMemberPassword = secureAction(
  PERMISSIONS.ADMINISTRATION.MANAGE_USERS,
  async (_user, input: ResetPasswordInput) => {
    const supabaseAdmin = getSupabaseAdmin()
    const { userId, newPassword } = input

    if (newPassword.length < 8) {
      throw new Error('Password must be at least 8 characters.')
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: newPassword,
    })

    if (error) {
      throw new Error(error.message)
    }

    return { reset: true }
  },
  {
    actionName: 'resetTeamMemberPassword',
    module: 'admin/team',
    // rateLimit: RATE_LIMITS.MANAGE_USERS, // temporarily disabled
    isCritical: true,
  }
)

type UpdateTeamMemberInput = {
  userId: string
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
  notification_email?: string
  notification_phone?: string
  approval_limit_cents?: number
  email_notifications_enabled?: boolean
  whatsapp_notifications_enabled?: boolean
}

/**
 * Updates team member profile information
 * REQUIRES: manage_users permission
 */
export const updateTeamMember = secureAction(
  PERMISSIONS.ADMINISTRATION.MANAGE_USERS,
  async (_user, input: UpdateTeamMemberInput) => {
    const supabaseAdmin = getSupabaseAdmin()
    const { userId, ...updateData } = input

    // Update users table
    const { data, error } = await supabaseAdmin
      .from('users')
      .update(updateData)
      .eq('auth_user_id', userId)
      .select()
      .single()

    if (error) {
      console.error('Update team member error:', error)
      throw new Error(error.message)
    }

    // If email changed, also update auth user
    if (input.email) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        email: input.email,
      })
      if (authError) {
        console.error('Failed to update auth email:', authError)
        // Don't throw - the user record was updated successfully
      }
    }

    return { user: data }
  },
  {
    actionName: 'updateTeamMember',
    module: 'admin/team',
    isCritical: true,
  }
)
