/**
 * PM data-scoping helpers.
 *
 * A Project Manager may only see data for projects they are assigned to via
 * the `project_assignments` table. Other privileged roles (admin, accountant)
 * are intentionally NOT scoped here so that the shared PM server actions keep
 * returning full data when those roles call them.
 *
 * Scoping rule:
 *   - role === 'project_manager'  -> restricted to assigned project ids
 *   - any other role              -> unscoped (sees everything)
 *
 * When a scoped PM has zero assignments, callers should render an empty state
 * and must never fall back to "all projects".
 */

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { resolveInternalUserId } from '@/lib/utils/resolve-user'

/** project_assignments.role values that grant a PM access to a project. */
const PM_PROJECT_ROLES = ['project_manager', 'pm'] as const

export type PmScope =
  /** Caller can see everything (admin / accountant / other privileged roles). */
  | { scoped: false }
  /** Caller is a PM restricted to these assigned project ids (may be empty). */
  | { scoped: true; projectIds: string[] }

type ScopeUser = { id: string; role?: string | null }

/**
 * Return the distinct project ids a PM (by auth user id) is assigned to.
 * Returns an empty array when the user can't be resolved or has no assignments.
 */
export async function getAssignedProjectIds(authUserId: string): Promise<string[]> {
  const supabase = getSupabaseAdmin()
  const internalUserId = await resolveInternalUserId(authUserId, supabase)
  if (!internalUserId) return []

  const { data, error } = await supabase
    .from('project_assignments')
    .select('project_id')
    .eq('user_id', internalUserId)
    .in('role', PM_PROJECT_ROLES as unknown as string[])

  if (error || !data) return []
  return Array.from(
    new Set(data.map((r) => r.project_id).filter((id): id is string => Boolean(id)))
  )
}

/**
 * Resolve the data scope for the calling user. Only project managers are
 * restricted; everyone else is unscoped.
 */
export async function resolvePmScope(user: ScopeUser): Promise<PmScope> {
  if (user.role !== 'project_manager') return { scoped: false }
  const projectIds = await getAssignedProjectIds(user.id)
  return { scoped: true, projectIds }
}

/**
 * Whether the calling user may access a specific project. Unscoped roles always
 * may; scoped PMs only when the project is in their assignment list.
 */
export async function pmCanAccessProject(
  user: ScopeUser,
  projectId: string | null | undefined
): Promise<boolean> {
  const scope = await resolvePmScope(user)
  if (!scope.scoped) return true
  if (!projectId) return false
  return scope.projectIds.includes(projectId)
}
