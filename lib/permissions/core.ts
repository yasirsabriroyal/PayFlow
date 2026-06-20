/**
 * Core Permissions Module
 */

import { createClient } from '@/lib/supabase/server'
import {
  PERMISSIONS,
  ALL_PERMISSIONS,
  ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  PROTECTED_ADMIN_PERMISSIONS,
  isValidPermission,
  isValidRole,
} from './constants'

// Define types locally to avoid Turbopack RSC type resolution issues
type Permission = (typeof ALL_PERMISSIONS)[number]
type UserRole = (typeof ROLES)[number]
type PermissionsMatrix = Record<UserRole, Permission[]>

// Export types
export type { Permission, PermissionsMatrix, UserRole }

// Re-export values
export {
  PERMISSIONS,
  ALL_PERMISSIONS,
  ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  PROTECTED_ADMIN_PERMISSIONS,
  isValidPermission,
  isValidRole,
}

// Simple in-memory cache
let permissionsCache: PermissionsMatrix | null = null
let cacheTimestamp = 0
const CACHE_TTL = 60000

export async function getPermissionsMatrix(): Promise<PermissionsMatrix> {
  const now = Date.now()
  if (permissionsCache && (now - cacheTimestamp) < CACHE_TTL) {
    return permissionsCache
  }
  
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('role_permissions')
    .select('role, permission')
  
  if (error || !data || data.length === 0) {
    return DEFAULT_ROLE_PERMISSIONS
  }
  
  // Start with default permissions, then merge database permissions
  const matrix: PermissionsMatrix = {
    admin: [...DEFAULT_ROLE_PERMISSIONS.admin],
    accountant: [...DEFAULT_ROLE_PERMISSIONS.accountant],
    project_manager: [...DEFAULT_ROLE_PERMISSIONS.project_manager],
    contractor: [...DEFAULT_ROLE_PERMISSIONS.contractor],
  }
  
  for (const row of data) {
    const role = row.role as UserRole
    const permission = row.permission as Permission
    
    if (ROLES.includes(role) && ALL_PERMISSIONS.includes(permission)) {
      if (!matrix[role].includes(permission)) {
        matrix[role].push(permission)
      }
    }
  }
  
  // Inline: ensure admin has protected permissions
  for (const perm of PROTECTED_ADMIN_PERMISSIONS) {
    if (!matrix.admin.includes(perm)) {
      matrix.admin.push(perm)
    }
  }
  
  permissionsCache = matrix
  cacheTimestamp = now
  
  return matrix
}

export async function getRolePermissions(role: UserRole): Promise<Permission[]> {
  const matrix = await getPermissionsMatrix()
  return matrix[role] || []
}

export async function hasPermission(
  userOrRole: { role: UserRole } | UserRole,
  permission: Permission
): Promise<boolean> {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole.role
  const permissions = await getRolePermissions(role)
  return permissions.includes(permission)
}

export async function hasAnyPermission(
  userOrRole: { role: UserRole } | UserRole,
  permissions: Permission[]
): Promise<boolean> {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole.role
  const userPermissions = await getRolePermissions(role)
  return permissions.some(p => userPermissions.includes(p))
}

export async function hasAllPermissions(
  userOrRole: { role: UserRole } | UserRole,
  permissions: Permission[]
): Promise<boolean> {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole.role
  const userPermissions = await getRolePermissions(role)
  return permissions.every(p => userPermissions.includes(p))
}

export interface CurrentUser {
  id: string
  email: string | undefined
  role: UserRole
}

export { getCurrentUser } from './auth'
import { getCurrentUser } from './auth'

/**
 * Thrown by requirePermission() and protect-route helpers when a user lacks
 * the required permission or is not authenticated.
 */
export class PermissionError extends Error {
  readonly permission: string | undefined
  readonly statusCode: number

  constructor(message: string, permission?: string, statusCode = 403) {
    super(message)
    this.name = 'PermissionError'
    this.permission = permission
    this.statusCode = statusCode
  }
}

export function clearPermissionsCache(): void {
  permissionsCache = null
  cacheTimestamp = 0
}

/**
 * Higher-order function to wrap server actions with permission checks
 * Returns the action result directly if successful, or error object if not
 * Passes the current user data to the action callback
 */
export async function withPermission<T>(
  permission: Permission,
  action: (userData: CurrentUser) => Promise<T>
): Promise<T | { success: false; error: string }> {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return { success: false, error: 'Not authenticated' }
    }

    const permitted = await hasPermission(user, permission)

    if (!permitted) {
      return { success: false, error: 'Permission denied' }
    }

    // Pass user data to the action and return result directly
    return await action(user)
  } catch (error) {
    console.error('[withPermission] Unexpected error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
