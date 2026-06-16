/**
 * Project-scoped permission layer.
 *
 * This is an ADDITIVE allow-layer on top of the global RBAC engine
 * (lib/permissions/core.ts). A user's effective permission for an action on a
 * specific project is:
 *
 *     globalHasPermission(role, permission)  OR
 *     anyActiveProjectAssignmentGrants(permission, projectId)
 *
 * Per the approved design, this never introduces new *denials* — it only grants
 * extra allow-paths. Data scoping is unchanged: being a project member does not
 * widen which projects' rows a user can see (only global PMs stay scoped).
 *
 * Tables (RLS-protected, service-role only) are read via the admin client.
 */

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { resolveInternalUserId } from '@/lib/utils/resolve-user'
import { ALL_PERMISSIONS } from './constants'
import type { Permission } from './constants'
import { hasPermission } from './core'
import type { UserRole } from './core'
import { getCurrentUser } from './auth'

/**
 * All permissions granted to an internal user on a given project, via their
 * active project-role assignments. Returns a de-duplicated, catalog-validated
 * list. Empty array when the user has no active assignment on the project.
 */
export async function getProjectPermissionsForUser(
  internalUserId: string,
  projectId: string,
): Promise<Permission[]> {
  if (!internalUserId || !projectId) return []

  const admin = getSupabaseAdmin()

  // 1. Active assignments for this user on this project that map to a role.
  const { data: assignments, error: assignErr } = await admin
    .from('project_assignments')
    .select('project_role_id')
    .eq('user_id', internalUserId)
    .eq('project_id', projectId)
    .eq('is_active', true)
    .not('project_role_id', 'is', null)

  if (assignErr || !assignments || assignments.length === 0) return []

  const roleIds = Array.from(
    new Set(assignments.map((a) => a.project_role_id as string).filter(Boolean)),
  )
  if (roleIds.length === 0) return []

  // 2. Permission grants for those roles.
  const { data: grants, error: grantErr } = await admin
    .from('project_role_permissions')
    .select('permission')
    .in('project_role_id', roleIds)

  if (grantErr || !grants) return []

  const permissions = grants
    .map((g) => g.permission as Permission)
    .filter((p) => ALL_PERMISSIONS.includes(p))

  return Array.from(new Set(permissions))
}

/**
 * Effective check for a permission on a specific project: global RBAC OR any
 * project-role grant. `authUserId` is the Supabase auth id (from getCurrentUser).
 */
export async function hasPermissionForProject(
  user: { role: UserRole; authUserId: string },
  projectId: string,
  permission: Permission,
): Promise<boolean> {
  // Global grant short-circuits (cheaper and covers admins/global roles).
  if (await hasPermission(user.role, permission)) return true

  if (!projectId) return false

  const admin = getSupabaseAdmin()
  const internalUserId = await resolveInternalUserId(user.authUserId, admin)
  if (!internalUserId) return false

  const projectPermissions = await getProjectPermissionsForUser(internalUserId, projectId)
  return projectPermissions.includes(permission)
}

/**
 * Action guard: run `action` only if the current user has `permission` either
 * globally OR via an active project-role assignment on `projectId`.
 *
 * Additive by design — callers that previously used the global `withPermission`
 * can switch to this to ALSO allow project-scoped members, without removing any
 * existing global access. Returns a standard `{ success, error }` envelope on
 * denial so it composes with existing action return types.
 */
export async function withProjectPermission<T>(
  projectId: string,
  permission: Permission,
  action: () => Promise<T>,
): Promise<T | { success: false; error: string }> {
  const user = await getCurrentUser()
  if (!user) {
    return { success: false, error: 'Unauthorized: Not authenticated' }
  }

  const allowed = await hasPermissionForProject(
    { role: user.role, authUserId: user.id },
    projectId,
    permission,
  )

  if (!allowed) {
    return {
      success: false,
      error: `Forbidden: Missing permission '${permission}' for this project`,
    }
  }

  return action()
}

/**
 * Action guard keyed off an INVOICE: resolves the invoice's project, then
 * allows the action if the current user has `permission` globally OR via an
 * active project-role assignment on that project. Passes the authenticated
 * user to `action` so callers keep their existing actor-building logic.
 *
 * Additive: this is a drop-in replacement for a global `withPermission` on
 * invoice actions that should also honor project-team grants.
 */
export async function withInvoiceProjectPermission<T>(
  invoiceId: string,
  permission: Permission,
  action: (user: { id: string; email?: string; role: UserRole }) => Promise<T>,
): Promise<T | { success: false; error: string }> {
  const user = await getCurrentUser()
  if (!user) {
    return { success: false, error: 'Unauthorized: Not authenticated' }
  }

  // Resolve the invoice's project for the scoped check.
  const admin = getSupabaseAdmin()
  const { data: invoice } = await admin
    .from('invoices')
    .select('project_id')
    .eq('id', invoiceId)
    .maybeSingle()

  const projectId = (invoice?.project_id as string | null) ?? ''

  const allowed = await hasPermissionForProject(
    { role: user.role, authUserId: user.id },
    projectId,
    permission,
  )

  if (!allowed) {
    return {
      success: false,
      error: `Forbidden: Missing permission '${permission}' for this invoice`,
    }
  }

  return action({ id: user.id, email: user.email, role: user.role })
}
