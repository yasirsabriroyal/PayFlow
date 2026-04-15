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

// Assign a project manager to a project
export async function assignProjectManager(projectId: string, userId: string) {
  return withPermission(PERMISSIONS.PROJECTS.EDIT_PROJECTS, async () => {
    const supabase = getSupabaseAdmin()
    
    // First check if assignment already exists
    const { data: existing } = await supabase
      .from('project_assignments')
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .single()

    if (existing) {
      return { success: true, message: 'Already assigned' }
    }
    
    const { data, error } = await supabase
      .from('project_assignments')
      .insert({
        project_id: projectId,
        user_id: userId,
        role: 'project_manager',
        assigned_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) {
      console.error('[v0] assignProjectManager error:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/admin/projects')
    return { success: true, assignment: data }
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
