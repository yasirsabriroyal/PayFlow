'use server'

import { getPermissionsMatrix } from '@/lib/permissions'
import { 
  updatePermissionsMatrix as updateMatrix,
  resetPermissionsToDefaults as resetDefaults,
} from '@/lib/permissions/actions'
import type { PermissionsMatrix } from '@/lib/permissions/constants'

/**
 * Server action to fetch the current permissions matrix.
 * Used by the client-side permissions management page.
 */
export async function fetchPermissionsMatrix(): Promise<PermissionsMatrix> {
  return getPermissionsMatrix()
}

/**
 * Server action to update the permissions matrix.
 * Wraps the secureAction-protected updatePermissionsMatrix.
 */
export async function savePermissionsMatrix(newMatrix: PermissionsMatrix) {
  return updateMatrix({ newMatrix })
}

/**
 * Server action to reset permissions to defaults.
 * Wraps the secureAction-protected resetPermissionsToDefaults.
 */
export async function resetPermissions() {
  return resetDefaults({})
}
