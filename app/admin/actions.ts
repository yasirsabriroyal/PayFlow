'use server'

import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { PERMISSIONS, withPermission } from '@/lib/permissions'
import { secureAction } from '@/lib/security/secureAction'
import { resolveInternalUserId } from '@/lib/utils/resolve-user'

// Create admin client for server actions
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// =====================================================
// DIRECT PAYMENT ACTIONS (Admin Only)
// =====================================================

export interface DirectPaymentInput {
  contractor_id: string
  project_id?: string
  amount_cents: number
  payment_method: 'eft' | 'cheque' | 'wire' | 'e-transfer'
  description: string
  notes?: string
}

export interface GetContractorsResult {
  success: boolean
  contractors: Array<{
    id: string
    company_name: string
    contact_name: string
    email: string
    status: string
  }>
  error?: string
}

export interface GetProjectsResult {
  success: boolean
  projects: Array<{
    id: string
    name: string
    project_number: string
  }>
  error?: string
}

/**
 * Create a direct payment without an invoice
 * Requires: create_direct_payment permission (admin/accountant only)
 * 
 * This creates both a payment_request and a payment record directly,
 * skipping the invoice approval workflow.
 */
export const createDirectPayment = secureAction(
  PERMISSIONS.PAYMENTS.CREATE_DIRECT_PAYMENT,
  async (user, input: DirectPaymentInput) => {
    // Validate required fields
    if (!input.contractor_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.contractor_id)) {
      throw new Error('Valid contractor is required')
    }
    
    if (!input.amount_cents || input.amount_cents <= 0) {
      throw new Error('Amount must be greater than 0')
    }
    
    if (input.amount_cents > 100000000) { // $1,000,000 limit
      throw new Error('Amount exceeds maximum allowed ($1,000,000)')
    }
    
    if (!input.description || input.description.trim().length < 5) {
      throw new Error('Description is required (minimum 5 characters)')
    }
    
    if (!['eft', 'cheque', 'wire', 'e-transfer'].includes(input.payment_method)) {
      throw new Error('Valid payment method is required')
    }
    
    const supabase = getSupabaseAdmin()
    
    // Get user record
    const { data: userData } = await supabase
      .from('users')
      .select('id, first_name, last_name, email, role')
      .eq('auth_user_id', user.id)
      .single()
    
    if (!userData) {
      throw new Error('User not found')
    }
    
    // Verify contractor exists
    const { data: contractor, error: contractorError } = await supabase
      .from('contractors')
      .select('id, company_name, status')
      .eq('id', input.contractor_id)
      .single()
    
    if (contractorError || !contractor) {
      throw new Error('Contractor not found')
    }
    
    if (contractor.status !== 'active') {
      throw new Error('Cannot create payment for inactive contractor')
    }
    
    // If project_id provided, verify it exists
    if (input.project_id) {
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('id')
        .eq('id', input.project_id)
        .single()
      
      if (projectError || !project) {
        throw new Error('Project not found')
      }
    }
    
    // Generate request number
    const timestamp = Date.now()
    const requestNumber = `DP-${new Date().getFullYear()}-${String(timestamp).slice(-6)}`
    
    // Create payment request (direct payments auto-approved)
    const { data: paymentRequest, error: prError } = await supabase
      .from('payment_requests')
      .insert({
        contractor_id: input.contractor_id,
        project_id: input.project_id || null,
        requested_amount_cents: input.amount_cents,
        approved_amount_cents: input.amount_cents,
        status: 'approved',
        current_approval_tier: 'admin',
        payment_method: input.payment_method,
        description: input.description,
        request_number: requestNumber,
        created_by: userData.id,
        processed_by: userData.id,
        processed_at: new Date().toISOString(),
      })
      .select()
      .single()
    
    if (prError) {
      console.error('Create payment request error:', prError)
      throw new Error(`Failed to create payment request: ${prError.message}`)
    }
    
    // Create the actual payment record
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        payment_request_id: paymentRequest.id,
        contractor_id: input.contractor_id,
        amount_cents: input.amount_cents,
        payment_method: input.payment_method,
        payment_date: new Date().toISOString().split('T')[0],
        status: 'pending',
        notes: input.notes || `Direct payment: ${input.description}`,
        processed_by: userData.id,
      })
      .select()
      .single()
    
    if (paymentError) {
      console.error('Create payment error:', paymentError)
      // Rollback payment request
      await supabase.from('payment_requests').delete().eq('id', paymentRequest.id)
      throw new Error(`Failed to create payment: ${paymentError.message}`)
    }
    
    // Log the action in audit_logs
    await supabase.from('audit_logs').insert({
      action: 'direct_payment_created',
      entity_type: 'payment',
      entity_id: payment.id,
      user_id: userData.id,
      user_email: userData.email,
      user_role: userData.role,
      new_values: {
        contractor_id: input.contractor_id,
        contractor_name: contractor.company_name,
        amount_cents: input.amount_cents,
        payment_method: input.payment_method,
        description: input.description,
        request_number: requestNumber,
      },
      description: `Direct payment of $${(input.amount_cents / 100).toFixed(2)} created for ${contractor.company_name}`,
    })
    
    revalidatePath('/admin/payments')
    revalidatePath('/admin/accounting')
    revalidatePath('/accountant/payments')
    
    return { 
      success: true, 
      payment,
      paymentRequest,
      requestNumber,
    }
  },
  {
    actionName: 'createDirectPayment',
    module: 'admin',
    isCritical: true,
    getPolicyContext: (input) => {
      const paymentInput = input as DirectPaymentInput
      return {
        amountCents: paymentInput.amount_cents,
      }
    },
  }
)

/**
 * Get all active contractors for the payment form dropdown
 */
export async function getActiveContractors() {
  return withPermission(PERMISSIONS.VENDORS.VIEW_VENDORS, async () => {
    try {
      const supabase = getSupabaseAdmin()

      const { data, error } = await supabase
        .from('contractors')
        .select('id, company_name, contact_name, email, status')
        .eq('status', 'active')
        .order('company_name')

      if (error) {
        console.error('Get contractors error:', error)
        return { success: false, contractors: [], error: error.message }
      }

      return { success: true, contractors: data || [] }
    } catch (err) {
      console.error('Get contractors error:', err)
      return { success: false, contractors: [], error: 'Failed to load contractors' }
    }
  })
}

/**
 * Get all active projects for the payment form dropdown
 */
export async function getActiveProjects() {
  return withPermission(PERMISSIONS.PROJECTS.VIEW_PROJECTS, async () => {
    try {
      const supabase = getSupabaseAdmin()

      const { data, error } = await supabase
        .from('projects')
        .select('id, name, project_number')
        .eq('is_active', true)
        .order('project_number')

      if (error) {
        console.error('Get projects error:', error)
        return { success: false, projects: [], error: error.message }
      }

      return { success: true, projects: data || [] }
    } catch (err) {
      console.error('Get projects error:', err)
      return { success: false, projects: [], error: 'Failed to load projects' }
    }
  })
}

// =====================================================
// COMPANY SETTINGS ACTIONS
// =====================================================

export async function getCompanySettings() {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async () => {
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from('company_settings')
      .select('*')
      .limit(1)
      .single()

    if (error) {
      console.error('Get company settings error:', error)
      return { success: false, error: error.message }
    }

    return { success: true, settings: data }
  })
}

export interface UpdateCompanySettingsInput {
  company_name?: string
  address?: string
  city?: string
  province?: string
  postal_code?: string
  phone?: string
  email?: string
  website?: string
  hst_number?: string
}

export async function updateCompanySettings(data: UpdateCompanySettingsInput) {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async (userData) => {
    const supabase = getSupabaseAdmin()

    const { data: existing } = await supabase
      .from('company_settings')
      .select('id')
      .limit(1)
      .single()

    const { error } = existing
      ? await supabase
          .from('company_settings')
          .update({ ...data, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
      : await supabase
          .from('company_settings')
          .insert({ ...data, updated_at: new Date().toISOString() })

    if (error) {
      console.error('Update company settings error:', error)
      return { success: false, error: error.message }
    }

    const { data: result } = await supabase
      .from('company_settings')
      .select('id')
      .limit(1)
      .single()

    const internalUserId = await resolveInternalUserId(userData.id, supabase)

    await supabase.from('audit_logs').insert({
      action: 'company_settings_updated',
      entity_type: 'company_settings',
      entity_id: result?.id,
      user_id: internalUserId,
      new_values: data,
    })

    revalidatePath('/admin')
    return { success: true }
  })
}
