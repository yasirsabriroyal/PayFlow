import { createClient } from '@/lib/supabase/server'
import type { Permission, UserRole } from './constants'
import { ROLES, DEFAULT_ROLE_PERMISSIONS } from './constants'

// ============================================
// USER CONTEXT (no circular dependencies)
// ============================================

export interface AuthenticatedUser {
  id: string
  email: string | undefined
  role: UserRole
  /** Optional pre-loaded permission list for policy evaluation */
  permissions?: Permission[]
}

/**
 * Get current authenticated user with their role.
 * Role is read from the profiles table (server-side, trusted) — never from
 * user_metadata which is writable by the client via supabase.auth.updateUser().
 */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const role: UserRole = profile?.role && ROLES.includes(profile.role as UserRole)
    ? (profile.role as UserRole)
    : 'contractor'

  return {
    id: user.id,
    email: user.email,
    role,
  }
}

// ============================================
// PERMISSION ERROR
// ============================================

export class PermissionError extends Error {
  constructor(
    message: string,
    public readonly permission?: Permission,
    public readonly statusCode: number = 403
  ) {
    super(message)
    this.name = 'PermissionError'
  }
}

// ============================================
// SIMPLE PERMISSION CHECKING (no DB dependency)
// Uses in-memory defaults for bootstrap, then DB cache
// ============================================

/**
 * Check if a role has a permission (uses defaults for bootstrap)
 */
export function hasPermissionSync(role: UserRole, permission: Permission): boolean {
  const permissions = DEFAULT_ROLE_PERMISSIONS[role] || []
  return permissions.includes(permission)
}

/**
 * Require authentication - throws if not authenticated
 */
export async function requireAuth(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser()
  
  if (!user) {
    throw new PermissionError('Unauthorized: Not authenticated', undefined, 401)
  }
  
  return user
}

/**
 * Require a specific permission - uses sync check for simplicity
 * For full DB-backed permission checks, use the version from lib/permissions/index.ts
 */
export async function requirePermissionSimple(permission: Permission): Promise<AuthenticatedUser> {
  const user = await requireAuth()
  
  if (!hasPermissionSync(user.role, permission)) {
    throw new PermissionError(
      `Forbidden: Missing permission '${permission}'`,
      permission
    )
  }
  
  return user
}
