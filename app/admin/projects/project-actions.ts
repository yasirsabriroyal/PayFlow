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
import {
  computeNextProjectNumber,
  isValidProjectNumber,
} from '@/lib/projects/project-number'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Tables that, if they reference a project, mean the project is "in use" and
// its number must not be changed without explicit admin confirmation.
const PROJECT_USAGE_TABLES = [
  'invoices',
  'payment_certificates',
  'payment_requests',
  'project_contractors',
  'holdback_ledgers',
  'change_orders',
  'lien_waivers',
] as const

/**
 * Fetch every existing project number. Kept as a helper so that, when a
 * tenant/organization column is later added to `projects`, scoping can be
 * applied in one place.
 */
async function fetchExistingProjectNumbers(
  supabase: ReturnType<typeof getSupabaseAdmin>,
): Promise<string[]> {
  const { data, error } = await supabase.from('projects').select('project_number')
  if (error) {
    console.error('[v0] fetchExistingProjectNumbers error:', error)
    return []
  }
  return (data || []).map((r) => r.project_number).filter(Boolean) as string[]
}

/** Returns the next system-generated project number for the current year. */
export async function getNextProjectNumber() {
  return withPermission(PERMISSIONS.PROJECTS.VIEW_PROJECTS, async () => {
    const supabase = getSupabaseAdmin()
    const existing = await fetchExistingProjectNumbers(supabase)
    const year = new Date().getFullYear()
    return { success: true, projectNumber: computeNextProjectNumber(existing, year) }
  })
}

/** Count how many records across project-related tables reference a project. */
async function countProjectUsage(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  projectId: string,
): Promise<number> {
  let total = 0
  for (const table of PROJECT_USAGE_TABLES) {
    const { count, error } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
    if (!error && typeof count === 'number') {
      total += count
    }
  }
  return total
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
  project_number?: string
  address_line1?: string
  city?: string
  province?: string
  description?: string
  start_date?: string
  estimated_completion_date?: string
  original_budget_cents: number
}) {
  return withPermission(PERMISSIONS.PROJECTS.CREATE_PROJECTS, async (user) => {
    const supabase = getSupabaseAdmin()

    const year = new Date().getFullYear()
    const existing = await fetchExistingProjectNumbers(supabase)

    // Determine whether the admin manually supplied a number (override) or we
    // auto-generate the next available one.
    const requested = input.project_number?.trim()
    const isManualOverride = Boolean(requested)
    let projectNumber = requested || computeNextProjectNumber(existing, year)

    if (isManualOverride) {
      // Server-side format validation (never trust the client).
      if (!isValidProjectNumber(projectNumber)) {
        return {
          success: false,
          error: 'Project number must use the format PRJ-YYYY-### (e.g. PRJ-2026-001).',
        }
      }
      // Server-side duplicate check in addition to the DB unique constraint.
      if (existing.includes(projectNumber)) {
        return {
          success: false,
          error: `Project number ${projectNumber} is already in use. Choose a unique number.`,
        }
      }
    } else {
      // Defensive: if a race produced a collision, advance to the next free one.
      while (existing.includes(projectNumber)) {
        existing.push(projectNumber)
        projectNumber = computeNextProjectNumber(existing, year)
      }
    }

    const { data, error } = await supabase
      .from('projects')
      .insert({
        name: input.name,
        project_number: projectNumber,
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
      // Unique-violation safety net (Postgres code 23505).
      if ((error as { code?: string }).code === '23505') {
        return {
          success: false,
          error: `Project number ${projectNumber} is already in use. Choose a unique number.`,
        }
      }
      console.error('[v0] createProject error:', error)
      return { success: false, error: error.message }
    }

    // Audit a manual override at creation time.
    if (isManualOverride && data) {
      await supabase.from('audit_logs').insert({
        action: 'create',
        entity_type: 'projects',
        entity_id: data.id,
        user_id: user.id,
        user_email: user.email ?? null,
        description: `Project created with manually overridden project number ${projectNumber}.`,
        new_values: { project_number: projectNumber, manual_override: true },
      })
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
  },
  options?: { confirmNumberChange?: boolean; reason?: string }
) {
  return withPermission(PERMISSIONS.PROJECTS.EDIT_PROJECTS, async (user) => {
    const supabase = getSupabaseAdmin()

    // Filter out undefined values
    const updateData = Object.fromEntries(
      Object.entries(input).filter(([, v]) => v !== undefined)
    )

    // Special handling when the project number is being changed.
    let numberChange: { from: string; to: string } | null = null
    if (typeof input.project_number === 'string') {
      const { data: current, error: currentError } = await supabase
        .from('projects')
        .select('project_number')
        .eq('id', id)
        .single()

      if (currentError || !current) {
        return { success: false, error: 'Project not found' }
      }

      const nextNumber = input.project_number.trim()

      if (nextNumber !== current.project_number) {
        // Format validation.
        if (!isValidProjectNumber(nextNumber)) {
          return {
            success: false,
            error: 'Project number must use the format PRJ-YYYY-### (e.g. PRJ-2026-001).',
          }
        }

        // Uniqueness validation (in addition to the DB unique constraint).
        const { data: dupe } = await supabase
          .from('projects')
          .select('id')
          .eq('project_number', nextNumber)
          .neq('id', id)
          .maybeSingle()
        if (dupe) {
          return {
            success: false,
            error: `Project number ${nextNumber} is already in use. Choose a unique number.`,
          }
        }

        // If the project is already in use, require explicit confirmation.
        const usage = await countProjectUsage(supabase, id)
        if (usage > 0 && !options?.confirmNumberChange) {
          return {
            success: false,
            requiresConfirmation: true,
            usageCount: usage,
            error: `This project has ${usage} related record(s) (invoices, payments, contractors, etc.). Changing its number requires confirmation.`,
          }
        }

        numberChange = { from: current.project_number, to: nextNumber }
        updateData.project_number = nextNumber
      } else {
        // No actual change; avoid a no-op write to the column.
        delete updateData.project_number
      }
    }

    const { data, error } = await supabase
      .from('projects')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if ((error as { code?: string }).code === '23505') {
        return {
          success: false,
          error: 'Project number is already in use. Choose a unique number.',
        }
      }
      console.error('[v0] updateProject error:', error)
      return { success: false, error: error.message }
    }

    // Audit the project-number change with old/new values and reason.
    if (numberChange) {
      await supabase.from('audit_logs').insert({
        action: 'update',
        entity_type: 'projects',
        entity_id: id,
        user_id: user.id,
        user_email: user.email ?? null,
        description: `Project number changed from ${numberChange.from} to ${numberChange.to}.${
          options?.reason ? ` Reason: ${options.reason}` : ''
        }`,
        old_values: { project_number: numberChange.from },
        new_values: { project_number: numberChange.to, reason: options?.reason ?? null },
      })
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
