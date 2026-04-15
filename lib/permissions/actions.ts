'use server'

import { createClient } from '@/lib/supabase/server'
import {
  secureAction,
  RATE_LIMITS,
} from '@/lib/security/secureAction'
import { 
  Permission, 
  PERMISSIONS, 
  PermissionsMatrix,
  ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  PROTECTED_ADMIN_PERMISSIONS,
  validatePermissionsMatrix,
  deduplicateMatrix,
} from './constants'

// Inline function to ensure admin always has protected permissions
function applyProtectedAdminPermissions(matrix: PermissionsMatrix): PermissionsMatrix {
  const result = { ...matrix }
  for (const permission of PROTECTED_ADMIN_PERMISSIONS) {
    if (!result.admin.includes(permission)) {
      result.admin = [...result.admin, permission]
    }
  }
  return result
}

// ============================================
// INPUT TYPES
// ============================================

export interface UpdatePermissionsInput {
  newMatrix: Record<string, readonly Permission[]>
}

// ============================================
// INTERNAL HELPERS (avoid circular import from index.ts)
// ============================================

/**
 * Fetch permissions matrix directly from database
 * (Avoids importing from index.ts which would cause circular dependency)
 */
async function fetchPermissionsMatrix(): Promise<PermissionsMatrix> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('role_permissions')
    .select('role, permission')
  
  if (error) {
    console.error('Failed to fetch permissions:', error)
    return DEFAULT_ROLE_PERMISSIONS
  }
  
  // Build matrix from database rows
  const matrix: PermissionsMatrix = {
    admin: [],
    project_manager: [],
    accountant: [],
    contractor: [],
  }
  
  for (const row of data || []) {
    const role = row.role as keyof PermissionsMatrix
    if (role in matrix) {
      matrix[role] = [...matrix[role], row.permission as Permission]
    }
  }
  
  return matrix
}

// ============================================
// PERMISSION MANAGEMENT ACTIONS
// ============================================

/**
 * Update the permissions matrix for all roles
 * Rate limited: 10 actions per minute (CRITICAL)
 * 
 * Uses enterprise secureAction wrapper with:
 * - RBAC permission enforcement
 * - Rate limiting (prevent permission manipulation attacks)
 * - Security telemetry logging
 */
export const updatePermissionsMatrix = secureAction(
  PERMISSIONS.ADMINISTRATION.MANAGE_PERMISSIONS,
  async (user, input: UpdatePermissionsInput) => {
    const { newMatrix } = input
    
    // Strict validation of the input
    const validation = validatePermissionsMatrix(newMatrix)
    if (!validation.valid) {
      throw new Error(`Invalid permissions matrix: ${validation.errors.join(', ')}`)
    }
    
    const typedMatrix = newMatrix as PermissionsMatrix
    
    // Deduplicate permissions
    const dedupedMatrix = deduplicateMatrix(typedMatrix)
    
    // Enforce protected admin permissions (cannot be removed)
    const protectedMatrix = applyProtectedAdminPermissions(dedupedMatrix)
    
    // Get current matrix for audit logging
    const currentMatrix = await fetchPermissionsMatrix()
    
    const supabase = await createClient()
    
    // Delete existing permissions and insert new ones
    const { error: deleteError } = await supabase
      .from('role_permissions')
      .delete()
      .neq('role', '')
    
    if (deleteError) {
      console.error('Failed to delete permissions:', deleteError)
      throw new Error('Failed to update permissions')
    }
    
    // Build insert rows
    const rows: { role: string; permission: string }[] = []
    for (const role of ROLES) {
      for (const permission of protectedMatrix[role]) {
        rows.push({ role, permission })
      }
    }
    
    if (rows.length > 0) {
      const { error: insertError } = await supabase
        .from('role_permissions')
        .insert(rows)
      
      if (insertError) {
        console.error('Failed to insert permissions:', insertError)
        throw new Error('Failed to save permissions')
      }
    }
    
    // Audit log the change
    await supabase.from('audit_logs').insert({
      action: 'permissions_updated',
      entity_type: 'role_permissions',
      entity_id: 'system',
      user_id: user.id,
      changes: {
        previous: currentMatrix,
        new: protectedMatrix,
      },
    })
    
    // Note: Cache invalidation happens automatically on next request
    // since we're using database as source of truth
    
    return { updated: true }
  },
  {
    actionName: 'updatePermissionsMatrix',
    module: 'permissions',
    rateLimit: RATE_LIMITS.MANAGE_USERS,
    isCritical: true,
    // Policy context for permission change logging
    getPolicyContext: () => ({
      // Permission changes always go through audit logging
      // No specific amount/project context required
    }),
  }
)

/**
 * Reset permissions to canonical defaults
 * Rate limited: 10 actions per minute (CRITICAL)
 * 
 * Uses enterprise secureAction wrapper
 */
export const resetPermissionsToDefaults = secureAction(
  PERMISSIONS.ADMINISTRATION.MANAGE_PERMISSIONS,
  async (user, _input: Record<string, never>) => {
    // Get current matrix for audit logging
    const currentMatrix = await fetchPermissionsMatrix()
    
    const supabase = await createClient()
    
    // Delete all existing permissions
    await supabase.from('role_permissions').delete().neq('role', '')
    
    // Use canonical defaults from constants
    const rows: { role: string; permission: string }[] = []
    for (const role of ROLES) {
      for (const permission of DEFAULT_ROLE_PERMISSIONS[role]) {
        rows.push({ role, permission })
      }
    }
    
    const { error } = await supabase.from('role_permissions').insert(rows)
    
    if (error) {
      console.error('Failed to reset permissions:', error)
      throw new Error('Failed to reset permissions')
    }
    
    // Audit log the change
    await supabase.from('audit_logs').insert({
      action: 'permissions_reset_to_defaults',
      entity_type: 'role_permissions',
      entity_id: 'system',
      user_id: user.id,
      changes: {
        previous: currentMatrix,
        new: DEFAULT_ROLE_PERMISSIONS,
      },
    })
    
    // Note: Cache invalidation happens automatically on next request
    
    return { reset: true }
  },
  {
    actionName: 'resetPermissionsToDefaults',
    module: 'permissions',
    rateLimit: RATE_LIMITS.MANAGE_USERS,
    isCritical: true,
  }
)
