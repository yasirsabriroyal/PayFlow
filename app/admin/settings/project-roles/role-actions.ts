'use server'

/**
 * Project-role catalog management.
 *
 * Admins (MANAGE_ROLES) define org-specific project roles and the permissions
 * each role grants. These permissions feed the additive, project-scoped
 * permission layer in lib/permissions/project-roles.ts.
 */

import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { withPermission } from '@/lib/permissions'
import { PERMISSIONS, ALL_PERMISSIONS, isValidPermission } from '@/lib/permissions/constants'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
}

async function getDefaultOrgId(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const { data } = await supabase
    .from('organizations')
    .select('id')
    .eq('is_default', true)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

// List the full catalog (including inactive) with permission grants, for the
// management UI.
export async function getProjectRolesForManagement() {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_ROLES, async () => {
    const supabase = getSupabaseAdmin()

    const { data: roles, error } = await supabase
      .from('project_roles')
      .select('id, key, label, description, is_system, is_active')
      .order('is_system', { ascending: false })
      .order('label')

    if (error) {
      console.error('[v0] getProjectRolesForManagement error:', error)
      return { success: false, roles: [], error: error.message }
    }

    const roleIds = (roles || []).map((r) => r.id)
    const permsByRole: Record<string, string[]> = {}
    const countByRole: Record<string, number> = {}

    if (roleIds.length > 0) {
      const { data: grants } = await supabase
        .from('project_role_permissions')
        .select('project_role_id, permission')
        .in('project_role_id', roleIds)
      for (const g of grants || []) {
        ;(permsByRole[g.project_role_id] ||= []).push(g.permission)
      }

      const { data: assigns } = await supabase
        .from('project_assignments')
        .select('project_role_id')
        .in('project_role_id', roleIds)
        .eq('is_active', true)
      for (const a of assigns || []) {
        if (a.project_role_id) {
          countByRole[a.project_role_id] = (countByRole[a.project_role_id] || 0) + 1
        }
      }
    }

    const withPerms = (roles || []).map((r) => ({
      ...r,
      permissions: permsByRole[r.id] || [],
      assignmentCount: countByRole[r.id] || 0,
    }))

    return { success: true, roles: withPerms }
  })
}

export async function createProjectRole(input: {
  label: string
  description?: string
  permissions?: string[]
}) {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_ROLES, async () => {
    const supabase = getSupabaseAdmin()

    const label = input.label?.trim()
    if (!label) return { success: false, error: 'Role name is required' }

    const key = slugify(label)
    if (!key) return { success: false, error: 'Role name must contain letters or numbers' }

    const orgId = await getDefaultOrgId(supabase)

    // Enforce unique key per org.
    const { data: dupe } = await supabase
      .from('project_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('key', key)
      .maybeSingle()
    if (dupe) return { success: false, error: 'A role with a similar name already exists' }

    const { data: role, error } = await supabase
      .from('project_roles')
      .insert({
        organization_id: orgId,
        key,
        label,
        description: input.description?.trim() || null,
        is_system: false,
        is_active: true,
      })
      .select('id')
      .single()

    if (error || !role) {
      console.error('[v0] createProjectRole error:', error)
      return { success: false, error: error?.message || 'Failed to create role' }
    }

    // Optional initial permission grants.
    const perms = (input.permissions || []).filter(isValidPermission)
    if (perms.length > 0) {
      const rows = perms.map((permission) => ({ project_role_id: role.id, permission }))
      const { error: grantError } = await supabase.from('project_role_permissions').insert(rows)
      if (grantError) {
        console.error('[v0] createProjectRole grant error:', grantError)
      }
    }

    revalidatePath('/admin/settings/project-roles')
    return { success: true, id: role.id }
  })
}

export async function updateProjectRole(
  id: string,
  input: { label?: string; description?: string; is_active?: boolean },
) {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_ROLES, async () => {
    const supabase = getSupabaseAdmin()

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (input.label !== undefined) {
      const label = input.label.trim()
      if (!label) return { success: false, error: 'Role name cannot be empty' }
      update.label = label
    }
    if (input.description !== undefined) update.description = input.description.trim() || null
    if (input.is_active !== undefined) update.is_active = input.is_active

    const { error } = await supabase.from('project_roles').update(update).eq('id', id)
    if (error) {
      console.error('[v0] updateProjectRole error:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/admin/settings/project-roles')
    return { success: true }
  })
}

// Replace the full permission set for a role. System roles are still editable
// (an admin may tune what a PM can do), but they cannot be deleted.
export async function setProjectRolePermissions(id: string, permissions: string[]) {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_ROLES, async () => {
    const supabase = getSupabaseAdmin()

    const valid = Array.from(new Set(permissions.filter(isValidPermission)))
    const invalid = permissions.filter((p) => !ALL_PERMISSIONS.includes(p as never))
    if (invalid.length > 0) {
      return { success: false, error: `Invalid permission(s): ${invalid.join(', ')}` }
    }

    // Replace strategy: delete existing grants, insert the new set.
    const { error: delError } = await supabase
      .from('project_role_permissions')
      .delete()
      .eq('project_role_id', id)
    if (delError) {
      console.error('[v0] setProjectRolePermissions delete error:', delError)
      return { success: false, error: delError.message }
    }

    if (valid.length > 0) {
      const rows = valid.map((permission) => ({ project_role_id: id, permission }))
      const { error: insError } = await supabase.from('project_role_permissions').insert(rows)
      if (insError) {
        console.error('[v0] setProjectRolePermissions insert error:', insError)
        return { success: false, error: insError.message }
      }
    }

    revalidatePath('/admin/settings/project-roles')
    return { success: true }
  })
}

export async function deleteProjectRole(id: string) {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_ROLES, async () => {
    const supabase = getSupabaseAdmin()

    const { data: role } = await supabase
      .from('project_roles')
      .select('id, is_system')
      .eq('id', id)
      .maybeSingle()

    if (!role) return { success: false, error: 'Role not found' }
    if (role.is_system) return { success: false, error: 'System roles cannot be deleted' }

    // Block deletion while the role is still assigned to active members.
    const { count } = await supabase
      .from('project_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('project_role_id', id)
      .eq('is_active', true)

    if ((count || 0) > 0) {
      return {
        success: false,
        error: `Role is assigned to ${count} active member(s). Reassign them first.`,
      }
    }

    const { error } = await supabase.from('project_roles').delete().eq('id', id)
    if (error) {
      console.error('[v0] deleteProjectRole error:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/admin/settings/project-roles')
    return { success: true }
  })
}
