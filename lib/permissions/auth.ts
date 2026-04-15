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
}

/**
 * Get current authenticated user with their role
 * Returns null if not authenticated
 */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) return null
  
  // Get role from user metadata first (faster)
  const roleFromMetadata = user.user_metadata?.role as UserRole | undefined
  
  if (roleFromMetadata && ROLES.includes(roleFromMetadata)) {
    return {
      id: user.id,
      email: user.email,
      role: roleFromMetadata,
    }
  }
  
  // Fallback to users table
  const { data: userData } = await supabase
    .from('users')
    .select('role')
    .eq('auth_user_id', user.id)
    .single()
  
  return {
    id: user.id,
    email: user.email,
    role: (userData?.role as UserRole) || 'contractor',
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
