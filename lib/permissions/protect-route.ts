'use server'

import { redirect } from 'next/navigation'
import { getCurrentUser, hasPermission, hasAnyPermission } from './core'
import type { Permission, UserRole } from './constants'

/**
 * Route protection for server components
 * Redirects to appropriate page if user doesn't have required permission/role
 */
export async function protectRoute(options: {
  permission?: Permission
  requiredPermission?: Permission  // Alias for permission
  anyPermission?: Permission[]
  roles?: UserRole[]
  redirectTo?: string
}): Promise<{ id: string; email: string | undefined; role: UserRole }> {
  const user = await getCurrentUser()
  
  // Not authenticated - redirect to login
  if (!user) {
    redirect(options.redirectTo || '/auth/login')
  }
  
  // Check role restrictions
  if (options.roles && options.roles.length > 0) {
    if (!options.roles.includes(user.role)) {
      redirect(options.redirectTo || '/unauthorized')
    }
  }
  
  // Check single permission (support both 'permission' and 'requiredPermission')
  const singlePermission = options.permission || options.requiredPermission
  if (singlePermission) {
    const hasAccess = await hasPermission(user.role, singlePermission)
    if (!hasAccess) {
      redirect(options.redirectTo || '/unauthorized')
    }
  }
  
  // Check any of multiple permissions
  if (options.anyPermission && options.anyPermission.length > 0) {
    const hasAccess = await hasAnyPermission(user.role, options.anyPermission)
    if (!hasAccess) {
      redirect(options.redirectTo || '/unauthorized')
    }
  }
  
  return user
}

/**
 * Simple role check for route protection
 */
export async function requireRole(...roles: UserRole[]): Promise<{ id: string; email: string | undefined; role: UserRole }> {
  return protectRoute({ roles })
}

/**
 * Admin-only route protection
 */
export async function requireAdmin(): Promise<{ id: string; email: string | undefined; role: UserRole }> {
  return protectRoute({ roles: ['admin'] })
}

/**
 * Internal staff route protection (admin, pm, accountant)
 */
export async function requireInternalUser(): Promise<{ id: string; email: string | undefined; role: UserRole }> {
  return protectRoute({ roles: ['admin', 'project_manager', 'accountant'] })
}
