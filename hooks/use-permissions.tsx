'use client'

import { useState, useEffect, useCallback } from 'react'
import { getMyPermissions } from '@/lib/permissions/get-permissions'
import {
  Permission,
  UserRole,
} from '@/lib/permissions/constants'

interface PermissionsState {
  isLoading: boolean
  permissions: Permission[]
  role: UserRole | null
  error: string | null
}

/**
 * Client-side hook for checking permissions.
 * Delegates to a server action so no Supabase tables are queried from the
 * browser. Role is read from the profiles table server-side.
 */
export function usePermissions() {
  const [state, setState] = useState<PermissionsState>({
    isLoading: true,
    permissions: [],
    role: null,
    error: null,
  })

  const fetchPermissions = useCallback(async () => {
    try {
      const { role, permissions } = await getMyPermissions()

      if (!role) {
        setState({ isLoading: false, permissions: [], role: null, error: 'Not authenticated' })
        return
      }

      setState({ isLoading: false, permissions, role, error: null })
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
