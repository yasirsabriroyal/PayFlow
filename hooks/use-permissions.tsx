'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { 
  Permission, 
  UserRole, 
  ALL_PERMISSIONS,
  ROLES,
} from '@/lib/permissions/constants'

interface PermissionsState {
  isLoading: boolean
  permissions: Permission[]
  role: UserRole | null
  error: string | null
}

/**
 * Client-side hook for checking permissions
 * Fetches the user's role and permissions on mount
 */
export function usePermissions() {
  const [state, setState] = useState<PermissionsState>({
    isLoading: true,
    permissions: [],
    role: null,
    error: null,
  })

  const fetchPermissions = useCallback(async () => {
    const supabase = createClient()
    
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        setState({
          isLoading: false,
          permissions: [],
          role: null,
          error: 'Not authenticated',
        })
        return
      }
      
      // Get role from metadata or users table
      let role: UserRole = 'contractor'
      const roleFromMetadata = user.user_metadata?.role as UserRole | undefined
      
      if (roleFromMetadata && ROLES.includes(roleFromMetadata)) {
        role = roleFromMetadata
      } else {
        const { data: userData } = await supabase
          .from('users')
          .select('role')
          .eq('auth_user_id', user.id)
          .single()
        
        if (userData?.role) {
          role = userData.role as UserRole
        }
      }
      
      // Fetch permissions for this role
      const { data: permissionData, error: permError } = await supabase
        .from('role_permissions')
        .select('permission')
        .eq('role', role)
      
      if (permError) {
        throw permError
      }
      
      const permissions = (permissionData || [])
        .map(p => p.permission as Permission)
        .filter(p => ALL_PERMISSIONS.includes(p))
      
      setState({
        isLoading: false,
        permissions,
        role,
        error: null,
      })
    } catch (err) {
      setState({
        isLoading: false,
        permissions: [],
        role: null,
        error: err instanceof Error ? err.message : 'Failed to load permissions',
      })
    }
  }, [])

  useEffect(() => {
    fetchPermissions()
  }, [fetchPermissions])

  /**
   * Check if user has a specific permission
   */
  const hasPermission = useCallback((permission: Permission): boolean => {
    return state.permissions.includes(permission)
  }, [state.permissions])

  /**
   * Check if user has any of the specified permissions
   */
  const hasAnyPermission = useCallback((permissions: Permission[]): boolean => {
    return permissions.some(p => state.permissions.includes(p))
  }, [state.permissions])

  /**
   * Check if user has all of the specified permissions
   */
  const hasAllPermissions = useCallback((permissions: Permission[]): boolean => {
    return permissions.every(p => state.permissions.includes(p))
  }, [state.permissions])

  return {
    ...state,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    refetch: fetchPermissions,
  }
}

/**
 * Simple permission check component
 * Renders children only if user has the required permission
 */
export function RequirePermission({ 
  permission, 
  children,
  fallback = null,
}: { 
  permission: Permission
  children: React.ReactNode
  fallback?: React.ReactNode
}) {
  const { isLoading, hasPermission } = usePermissions()
  
  if (isLoading) return null
  if (!hasPermission(permission)) return <>{fallback}</>
  
  return <>{children}</>
}

/**
 * Renders children only if user has any of the specified permissions
 */
export function RequireAnyPermission({ 
  permissions, 
  children,
  fallback = null,
}: { 
  permissions: Permission[]
  children: React.ReactNode
  fallback?: React.ReactNode
}) {
  const { isLoading, hasAnyPermission } = usePermissions()
  
  if (isLoading) return null
  if (!hasAnyPermission(permissions)) return <>{fallback}</>
  
  return <>{children}</>
}
