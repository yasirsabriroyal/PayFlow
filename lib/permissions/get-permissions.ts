'use server'

import { createClient } from '@/lib/supabase/server'
import { ALL_PERMISSIONS, ROLES } from './constants'
import type { Permission, UserRole } from './constants'

/**
 * Server action: returns the current user's role and permissions.
 *
 * Role is read from the `profiles` table (server-side, trusted) rather than
 * from user_metadata (client-controlled) or the users table. Permissions are
 * fetched from role_permissions and filtered against the known permission list.
 */
export async function getMyPermissions(): Promise<{
  role: UserRole | null
  permissions: Permission[]
}> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { role: null, permissions: [] }

  // Trusted role source: profiles table, not user_metadata
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const role: UserRole = profile?.role && ROLES.includes(profile.role as UserRole)
    ? (profile.role as UserRole)
    : 'contractor'

  const { data: permissionData } = await supabase
    .from('role_permissions')
    .select('permission')
    .eq('role', role)

  const permissions = (permissionData ?? [])
    .map(p => p.permission as Permission)
    .filter(p => ALL_PERMISSIONS.includes(p))

  return { role, permissions }
}
