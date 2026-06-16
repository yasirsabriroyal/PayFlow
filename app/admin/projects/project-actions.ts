'use server'

/**
 * Admin Projects Actions
 * FRESH FILE - No secureAction, no RATE_LIMITS
 * Uses simple withPermission wrapper only
 */

import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { withPermission } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permissions/constants'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function getProjects() {
  return withPermission(PERMISSIONS.PROJECTS.VIEW_PROJECTS, async () => {
    const supabase = getSupabaseAdmin()
    
    const { data, error } = await supabase
      .from('projects')
      .select(`
        id, name, project_number, address_line1, city, province, 
        description, start_date, estimated_completion_date, actual_completion_date,
        substantial_performance_date, original_budget_cents, current_budget_cents, 
        spent_cents, committed_cents, is_active, created_at,
        project_assignments(id, user_id, role, users!project_assignments_user_id_fkey(id, first_name, last_name, email, role))
      `)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[v0] getProjects error:', error)
      return { success: false, projects: [], error: error.message }
    }

    return { success: true, projects: data || [] }
  })
}

// Get all project managers for assignment dropdown
export async function getProjectManagers() {
  return withPermission(PERMISSIONS.PROJECTS.VIEW_PROJECTS, async () => {
    const supabase = getSupabaseAdmin()
    
    const { data, error } = await supabase
      .from('users')
      .select('id, first_name, last_name, email, role')
      .in('role', ['admin', 'project_manager'])
      .eq('is_active', true)
      .order('first_name')

    if (error) {
      console.error('[v0] getProjectManagers error:', error)
      return { success: false, managers: [], error: error.message }
    }

    return { success: true, managers: data || [] }
  })
}

// All internal staff who can be assigned to a project team (contractors are
// handled separately via project_contractors).
export async function getAssignableUsers() {
  return withPermission(PERMISSIONS.PROJECTS.VIEW_PROJECTS, async () => {
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from('users')
      .select('id, first_name, last_name, email, role')
      .in('role', ['admin', 'project_manager', 'accountant'])
      .eq('is_active', true)
      .order('first_name')

    if (error) {
      console.error('[v0] getAssignableUsers error:', error)
      return { success: false, users: [], error: error.message }
    }

    return { success: true, users: data || [] }
  })
}

// Active project-role catalog (for the default organization) with the
// permission keys granted by each role.
export async function getProjectRolesCatalog() {
  return withPermission(PERMISSIONS.PROJECTS.VIEW_PROJECTS, async () => {
    const supabase = getSupabaseAdmin()

    const { data: roles, error } = await supabase
      .from('project_roles')
      .select('id, key, label, description, is_system, is_active, organization_id')
      .eq('is_active', true)
      .order('is_system', { ascending: false })
      .order('label')

    if (error) {
      console.error('[v0] getProjectRolesCatalog error:', error)
      return { success: false, roles: [], error: error.message }
    }

    const roleIds = (roles || []).map((r) => r.id)
    const permsByRole: Record<string, string[]> = {}
    if (roleIds.length > 0) {
      const { data: grants } = await supabase
        .from('project_role_permissions')
        .select('project_role_id, permission')
        .in('project_role_id', roleIds)

      for (const g of grants || []) {
        const list = permsByRole[g.project_role_id] || (permsByRole[g.project_role_id] = [])
        list.push(g.permission)
      }
    }

    const withPerms = (roles || []).map((r) => ({
      ...r,
      permissions: permsByRole[r.id] || [],
    }))

    return { success: true, roles: withPerms }
  })
}

// Full team for a project: active assignments joined to user + role info.
export async function getProjectTeam(projectId: string) {
  return withPermission(PERMISSIONS.PROJECTS.VIEW_PROJECTS, async () => {
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from('project_assignments')
      .select(`
        id, project_id, user_id, role, project_role_id, is_active, assigned_at,
        users!project_assignments_user_id_fkey(id, first_name, last_name, email, role),
        project_roles(id, key, label, is_system)
      `)
      .eq('project_id', projectId)
      .eq('is_active', true)
      .order('assigned_at', { ascending: true })

    if (error) {
      console.error('[v0] getProjectTeam error:', error)
      return { success: false, team: [], error: error.message }
    }

    return { success: true, team: data || [] }
  })
}

// Assign a team member to a project under a specific project role.
// A user may hold multiple distinct roles on the same project, but not the
// same role twice.
export async function assignProjectMember(
  projectId: string,
  userId: string,
  projectRoleId: string,
) {
  return withPermission(PERMISSIONS.PROJECTS.EDIT_PROJECTS, async () => {
    const supabase = getSupabaseAdmin()

    // Resolve the role so we can keep the legacy free-text `role` column in
    // sync (pm-scope and the notification engine still read it by key).
    const { data: role, error: roleError } = await supabase
      .from('project_roles')
      .select('id, key, is_active')
      .eq('id', projectRoleId)
      .single()

    if (roleError || !role) {
      return { success: false, error: 'Selected project role not found' }
    }
    if (role.is_active === false) {
      return { success: false, error: 'Selected project role is inactive' }
    }

    // Prevent duplicate (user, project, role) assignments.
    const { data: existing } = await supabase
      .from('project_assignments')
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .eq('project_role_id', projectRoleId)
      .maybeSingle()

    if (existing) {
      return { success: true, message: 'Already assigned to this role' }
    }

    const { data, error } = await supabase
      .from('project_assignments')
      .insert({
        project_id: projectId,
        user_id: userId,
        project_role_id: projectRoleId,
        role: role.key,
        is_active: true,
        assigned_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) {
      console.error('[v0] assignProjectMember error:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/admin/projects')
    revalidatePath(`/admin/projects/${projectId}`)
    return { success: true, assignment: data }
  })
}

// Back-compat: assign a user as Project Manager using the generalized flow.
export async function assignProjectManager(projectId: string, userId: string) {
  const supabase = getSupabaseAdmin()
  const { data: pmRole } = await supabase
    .from('project_roles')
    .select('id')
    .eq('key', 'project_manager')
    .order('created_at')
    .limit(1)
    .maybeSingle()

  if (!pmRole) {
    return { success: false, error: 'Project Manager role not configured' }
  }
  return assignProjectMember(projectId, userId, pmRole.id)
}

// Change the role of an existing assignment.
export async function updateProjectMemberRole(
  assignmentId: string,
  projectRoleId: string,
) {
  return withPermission(PERMISSIONS.PROJECTS.EDIT_PROJECTS, async () => {
    const supabase = getSupabaseAdmin()

    const { data: role, error: roleError } = await supabase
      .from('project_roles')
      .select('id, key')
      .eq('id', projectRoleId)
      .single()

    if (roleError || !role) {
      return { success: false, error: 'Selected project role not found' }
    }

    const { data, error } = await supabase
      .from('project_assignments')
      .update({ project_role_id: role.id, role: role.key })
      .eq('id', assignmentId)
      .select('project_id')
      .single()

    if (error) {
      console.error('[v0] updateProjectMemberRole error:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/admin/projects')
    if (data?.project_id) revalidatePath(`/admin/projects/${data.project_id}`)
    return { success: true }
  })
}

// Remove project manager assignment
export async function removeProjectAssignment(assignmentId: string) {
  return withPermission(PERMISSIONS.PROJECTS.EDIT_PROJECTS, async () => {
    const supabase = getSupabaseAdmin()
    
    const { error } = await supabase
      .from('project_assignments')
      .delete()
      .eq('id', assignmentId)

    if (error) {
      console.error('[v0] removeProjectAssignment error:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/admin/projects')
    return { success: true }
  })
}

export async function createProject(input: {
  name: string
  project_number: string
  address_line1?: string
  city?: string
  province?: string
  description?: string
  start_date?: string
  estimated_completion_date?: string
  original_budget_cents: number
}) {
  return withPermission(PERMISSIONS.PROJECTS.CREATE_PROJECTS, async () => {
    const supabase = getSupabaseAdmin()
    
    const { data, error } = await supabase
      .from('projects')
      .insert({
        name: input.name,
        project_number: input.project_number,
        address_line1: input.address_line1 || '',
        city: input.city || '',
        province: input.province || 'ON',
        description: input.description || '',
        start_date: input.start_date || null,
        estimated_completion_date: input.estimated_completion_date || null,
        original_budget_cents: input.original_budget_cents,
        current_budget_cents: input.original_budget_cents,
        spent_cents: 0,
        committed_cents: 0,
        is_active: true,
      })
      .select()
      .single()

    if (error) {
      console.error('[v0] createProject error:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/admin/projects')
    return { success: true, project: data }
  })
}

export async function updateProject(
  id: string,
  input: {
    name?: string
    project_number?: string
    address_line1?: string
    city?: string
    province?: string
    description?: string
    start_date?: string | null
    estimated_completion_date?: string | null
    actual_completion_date?: string | null
    substantial_performance_date?: string | null
    original_budget_cents?: number
    current_budget_cents?: number
    is_active?: boolean
  }
) {
  return withPermission(PERMISSIONS.PROJECTS.EDIT_PROJECTS, async () => {
    const supabase = getSupabaseAdmin()
    
    // Filter out undefined values
    const updateData = Object.fromEntries(
      Object.entries(input).filter(([_, v]) => v !== undefined)
    )
    
    const { data, error } = await supabase
      .from('projects')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('[v0] updateProject error:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/admin/projects')
    return { success: true, project: data }
  })
}

export async function archiveProject(id: string) {
  return withPermission(PERMISSIONS.PROJECTS.ARCHIVE_PROJECTS, async () => {
    const supabase = getSupabaseAdmin()
    
    const { error } = await supabase
      .from('projects')
      .update({ is_active: false })
      .eq('id', id)

    if (error) {
      console.error('[v0] archiveProject error:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/admin/projects')
    return { success: true }
  })
}

export async function restoreProject(id: string) {
  return withPermission(PERMISSIONS.PROJECTS.ARCHIVE_PROJECTS, async () => {
    const supabase = getSupabaseAdmin()
    
    const { error } = await supabase
      .from('projects')
      .update({ is_active: true })
      .eq('id', id)

    if (error) {
      console.error('[v0] restoreProject error:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/admin/projects')
    return { success: true }
  })
}
