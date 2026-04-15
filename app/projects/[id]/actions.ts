'use server'

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { withPermission } from '@/lib/permissions'
import { PERMISSIONS } from '@/lib/permissions/constants'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export interface ProjectHubData {
  project: {
    id: string
    name: string
    project_number: string
    description: string | null
    address_line1: string | null
    city: string | null
    province: string | null
    start_date: string | null
    estimated_completion_date: string | null
    actual_completion_date: string | null
    substantial_performance_date: string | null
    original_budget_cents: number
    current_budget_cents: number
    spent_cents: number
    committed_cents: number
    is_active: boolean
    created_at: string
  }
  invoices: Array<{
    id: string
    invoice_number: string
    total_cents: number
    status: string
    invoice_date: string | null
    contractor: { company_name: string } | null
  }>
  changeOrders: Array<{
    id: string
    co_number: string
    description: string
    amount_cents: number
    status: string
    created_at: string
    approved_at: string | null
    contractor: { company_name: string } | null
  }>
  contractors: Array<{
    id: string
    company_name: string
    contact_name: string
    email: string
    status: string
    total_billed_cents: number
    total_paid_cents: number
  }>
  assignments: Array<{
    id: string
    user_id: string
    role: string
    assigned_at: string
    user: {
      id: string
      first_name: string
      last_name: string
      email: string
      role: string
    } | null
  }>
  summary: {
    total_invoices: number
    total_invoiced_cents: number
    total_paid_cents: number
    pending_approval_cents: number
    active_contractors: number
    approved_change_orders_cents: number
  }
}

export async function getProjectHub(projectId: string): Promise<{
  success: boolean
  data?: ProjectHubData
  error?: string
}> {
  return withPermission(PERMISSIONS.PROJECTS.VIEW_PROJECTS, async () => {
    const supabase = getSupabaseAdmin()

    // Fetch project
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      return { success: false, error: 'Project not found' }
    }

    // Fetch invoices for this project
    const { data: invoices } = await supabase
      .from('invoices')
      .select('id, invoice_number, total_cents, status, invoice_date, contractor:contractors(company_name)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    // Fetch change orders
    const { data: changeOrders } = await supabase
      .from('change_orders')
      .select('id, co_number, description, amount_cents, status, created_at, approved_at, contractor:contractors(company_name)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    // Fetch project assignments
    const { data: assignments } = await supabase
      .from('project_assignments')
      .select('id, user_id, role, assigned_at, user:users!project_assignments_user_id_fkey(id, first_name, last_name, email, role)')
      .eq('project_id', projectId)

    // Get unique contractors from invoices
    const contractorIds = [...new Set((invoices || []).map(inv => {
      // Extract contractor_id from the invoice if available
      return (inv as unknown as { contractor_id?: string }).contractor_id
    }).filter(Boolean))]

    // For contractors, we aggregate invoice data
    const contractorMap = new Map<string, {
      id: string
      company_name: string
      contact_name: string
      email: string
      status: string
      total_billed_cents: number
      total_paid_cents: number
    }>()

    // Build contractor summary from invoices
    for (const inv of (invoices || [])) {
      const contractor = inv.contractor as { company_name: string } | null
      if (contractor) {
        const existing = contractorMap.get(contractor.company_name)
        if (existing) {
          existing.total_billed_cents += inv.total_cents || 0
        } else {
          contractorMap.set(contractor.company_name, {
            id: contractor.company_name, // Use company_name as temp ID
            company_name: contractor.company_name,
            contact_name: '',
            email: '',
            status: 'active',
            total_billed_cents: inv.total_cents || 0,
            total_paid_cents: 0,
          })
        }
      }
    }

    const contractors = Array.from(contractorMap.values())

    // Calculate summary
    const totalInvoicedCents = (invoices || []).reduce((sum, inv) => sum + (inv.total_cents || 0), 0)
    const paidInvoices = (invoices || []).filter(inv => inv.status === 'paid')
    const totalPaidCents = paidInvoices.reduce((sum, inv) => sum + (inv.total_cents || 0), 0)
    const pendingInvoices = (invoices || []).filter(inv => ['submitted', 'pending_approval'].includes(inv.status))
    const pendingApprovalCents = pendingInvoices.reduce((sum, inv) => sum + (inv.total_cents || 0), 0)
    const approvedCOs = (changeOrders || []).filter(co => co.status === 'approved')
    const approvedCOsCents = approvedCOs.reduce((sum, co) => sum + (co.amount_cents || 0), 0)

    return {
      success: true,
      data: {
        project,
        invoices: invoices || [],
        changeOrders: changeOrders || [],
        contractors,
        assignments: (assignments || []).map(a => ({
          ...a,
          user: Array.isArray(a.user) ? a.user[0] : a.user
        })),
        summary: {
          total_invoices: (invoices || []).length,
          total_invoiced_cents: totalInvoicedCents,
          total_paid_cents: totalPaidCents,
          pending_approval_cents: pendingApprovalCents,
          active_contractors: contractors.filter(c => c.status === 'active').length,
          approved_change_orders_cents: approvedCOsCents,
        },
      },
    }
  })
}

export async function updateProjectSection(
  projectId: string,
  section: 'details' | 'budget' | 'dates' | 'location' | 'all',
  data: Record<string, unknown>
) {
  return withPermission(PERMISSIONS.PROJECTS.EDIT_PROJECTS, async () => {
    const supabase = getSupabaseAdmin()

    // Map section to allowed fields
    const allowedFields: Record<string, string[]> = {
      details: ['name', 'project_number', 'description'],
      budget: ['original_budget_cents', 'current_budget_cents'],
      dates: ['start_date', 'estimated_completion_date', 'actual_completion_date', 'substantial_performance_date'],
      location: ['address_line1', 'city', 'province'],
      all: [
        'name', 'project_number', 'description',
        'original_budget_cents', 'current_budget_cents',
        'start_date', 'estimated_completion_date', 'actual_completion_date', 'substantial_performance_date',
        'address_line1', 'city', 'province',
      ],
    }

    const allowed = allowedFields[section] || []
    const updateData: Record<string, unknown> = {}

    for (const key of Object.keys(data)) {
      if (allowed.includes(key)) {
        // Handle empty strings for date fields - convert to null
        if (['start_date', 'estimated_completion_date', 'actual_completion_date', 'substantial_performance_date'].includes(key)) {
          updateData[key] = data[key] || null
        } else {
          updateData[key] = data[key]
        }
      }
    }

    if (Object.keys(updateData).length === 0) {
      return { success: false, error: 'No valid fields to update' }
    }

    const { data: project, error } = await supabase
      .from('projects')
      .update(updateData)
      .eq('id', projectId)
      .select()
      .single()

    if (error) {
      console.error('Failed to update project:', error)
      return { success: false, error: error.message }
    }

    revalidatePath(`/projects/${projectId}`)
    revalidatePath('/admin/projects')
    revalidatePath('/pm/projects')

    return { success: true, project }
  })
}

export async function toggleProjectStatus(projectId: string) {
  return withPermission(PERMISSIONS.PROJECTS.EDIT_PROJECTS, async () => {
    const supabase = getSupabaseAdmin()

    // Get current status
    const { data: current } = await supabase
      .from('projects')
      .select('is_active')
      .eq('id', projectId)
      .single()

    if (!current) {
      return { success: false, error: 'Project not found' }
    }

    const { data: project, error } = await supabase
      .from('projects')
      .update({ is_active: !current.is_active })
      .eq('id', projectId)
      .select()
      .single()

    if (error) {
      console.error('Failed to toggle project status:', error)
      return { success: false, error: error.message }
    }

    revalidatePath(`/projects/${projectId}`)
    revalidatePath('/admin/projects')
    revalidatePath('/pm/projects')

    return { success: true, project }
  })
}

// Project Contractor Assignment Types
export interface ProjectContractor {
  id: string
  project_id: string
  contractor_id: string
  trade: string | null
  notes: string | null
  contract_amount_cents: number | null
  status: 'active' | 'completed' | 'terminated'
  assigned_at: string
  contractor: {
    id: string
    company_name: string
    contact_name: string
    email: string
    phone: string | null
    status: string
  }
}

// Get all contractors assigned to a project
export async function getProjectContractors(projectId: string): Promise<{
  success: boolean
  data?: ProjectContractor[]
  error?: string
}> {
  return withPermission(PERMISSIONS.PROJECTS.VIEW_PROJECTS, async () => {
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from('project_contractors')
      .select(`
        id,
        project_id,
        contractor_id,
        trade,
        notes,
        contract_amount_cents,
        status,
        assigned_at,
        contractor:contractors(id, company_name, contact_name, email, phone, status)
      `)
      .eq('project_id', projectId)
      .order('assigned_at', { ascending: false })

    if (error) {
      console.error('Failed to fetch project contractors:', error)
      return { success: false, error: error.message }
    }

    // Flatten the contractor relation
    const contractors = (data || []).map(item => ({
      ...item,
      contractor: Array.isArray(item.contractor) ? item.contractor[0] : item.contractor
    })) as ProjectContractor[]

    return { success: true, data: contractors }
  })
}

// Get all available contractors (not yet assigned to this project)
export async function getAvailableContractors(projectId: string): Promise<{
  success: boolean
  data?: Array<{
    id: string
    company_name: string
    contact_name: string
    email: string
    status: string
  }>
  error?: string
}> {
  return withPermission(PERMISSIONS.PROJECTS.VIEW_PROJECTS, async () => {
    const supabase = getSupabaseAdmin()

    // Get already assigned contractor IDs
    const { data: assigned } = await supabase
      .from('project_contractors')
      .select('contractor_id')
      .eq('project_id', projectId)

    const assignedIds = (assigned || []).map(a => a.contractor_id)

    // Get all contractors (active or pending_kyc) not in the assigned list
    let query = supabase
      .from('contractors')
      .select('id, company_name, contact_name, email, status')
      .in('status', ['active', 'pending_kyc'])
      .order('company_name')

    if (assignedIds.length > 0) {
      query = query.not('id', 'in', `(${assignedIds.join(',')})`)
    }

    const { data, error } = await query

    if (error) {
      console.error('Failed to fetch available contractors:', error)
      return { success: false, error: error.message }
    }

    return { success: true, data: data || [] }
  })
}

// Assign a contractor to a project
export async function assignContractorToProject(
  projectId: string,
  contractorId: string,
  trade: string | null,
  notes: string | null,
  contractAmountCents: number | null
): Promise<{ success: boolean; data?: ProjectContractor; error?: string }> {
  return withPermission(PERMISSIONS.PROJECTS.EDIT_PROJECTS, async () => {
    const supabase = getSupabaseAdmin()

    // Check if already assigned
    const { data: existing } = await supabase
      .from('project_contractors')
      .select('id')
      .eq('project_id', projectId)
      .eq('contractor_id', contractorId)
      .single()

    if (existing) {
      return { success: false, error: 'Contractor is already assigned to this project' }
    }

    const { data, error } = await supabase
      .from('project_contractors')
      .insert({
        project_id: projectId,
        contractor_id: contractorId,
        trade: trade || null,
        notes: notes || null,
        contract_amount_cents: contractAmountCents || null,
        status: 'active',
      })
      .select(`
        id,
        project_id,
        contractor_id,
        trade,
        notes,
        contract_amount_cents,
        status,
        assigned_at,
        contractor:contractors(id, company_name, contact_name, email, phone, status)
      `)
      .single()

    if (error) {
      console.error('Failed to assign contractor:', error)
      return { success: false, error: error.message }
    }

    revalidatePath(`/projects/${projectId}`)

    const result = {
      ...data,
      contractor: Array.isArray(data.contractor) ? data.contractor[0] : data.contractor
    } as ProjectContractor

    return { success: true, data: result }
  })
}

// Update a project contractor assignment
export async function updateProjectContractor(
  assignmentId: string,
  updates: {
    trade?: string | null
    notes?: string | null
    contract_amount_cents?: number | null
    status?: 'active' | 'completed' | 'terminated'
  }
): Promise<{ success: boolean; error?: string }> {
  return withPermission(PERMISSIONS.PROJECTS.EDIT_PROJECTS, async () => {
    const supabase = getSupabaseAdmin()

    const { error } = await supabase
      .from('project_contractors')
      .update(updates)
      .eq('id', assignmentId)

    if (error) {
      console.error('Failed to update project contractor:', error)
      return { success: false, error: error.message }
    }

    // Get project ID for revalidation
    const { data } = await supabase
      .from('project_contractors')
      .select('project_id')
      .eq('id', assignmentId)
      .single()

    if (data) {
      revalidatePath(`/projects/${data.project_id}`)
    }

    return { success: true }
  })
}

// Remove a contractor from a project
export async function removeContractorFromProject(
  assignmentId: string
): Promise<{ success: boolean; error?: string }> {
  return withPermission(PERMISSIONS.PROJECTS.EDIT_PROJECTS, async () => {
    const supabase = getSupabaseAdmin()

    // Get project ID before deletion for revalidation
    const { data: assignment } = await supabase
      .from('project_contractors')
      .select('project_id')
      .eq('id', assignmentId)
      .single()

    const { error } = await supabase
      .from('project_contractors')
      .delete()
      .eq('id', assignmentId)

    if (error) {
      console.error('Failed to remove contractor:', error)
      return { success: false, error: error.message }
    }

    if (assignment) {
      revalidatePath(`/projects/${assignment.project_id}`)
    }

    return { success: true }
  })
}
