'use server'

import { randomBytes } from 'crypto'
import { revalidatePath } from 'next/cache'
import {
  PERMISSIONS,
  withPermission,
} from '@/lib/permissions'
import {
  secureAction,
  RATE_LIMITS,
} from '@/lib/security/secureAction'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { sendContractorInvitationNotification } from '@/lib/notifications'

// =====================================================
// VIEW VENDORS
// =====================================================

export interface GetVendorsOptions {
  status?: 'active' | 'pending_kyc' | 'suspended' | 'inactive'
  search?: string
  limit?: number
  offset?: number
}

/**
 * Get list of vendors/contractors
 * Requires: view_vendors permission
 */
export async function getVendors(options?: GetVendorsOptions) {
  return withPermission(PERMISSIONS.VENDORS.VIEW_VENDORS, async () => {
    const supabase = getSupabaseAdmin()
    
    let query = supabase
      .from('contractors')
      .select('*', { count: 'exact' })
      .order('company_name', { ascending: true })
    
    if (options?.status) {
      query = query.eq('status', options.status)
    }
    
    if (options?.search) {
      query = query.or(
        `company_name.ilike.%${options.search}%,contact_name.ilike.%${options.search}%,email.ilike.%${options.search}%`
      )
    }
    
    if (options?.limit) {
      query = query.limit(options.limit)
    }
    
    if (options?.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 50) - 1)
    }
    
    const { data, error, count } = await query
    
    if (error) {
      console.error('Get vendors error:', error)
      return { success: false, error: error.message, vendors: [], total: 0 }
    }
    
    return { success: true, vendors: data || [], total: count || 0 }
  })
}

/**
 * Get single vendor details
 * Requires: view_vendors permission
 */
export async function getVendorById(vendorId: string) {
  return withPermission(PERMISSIONS.VENDORS.VIEW_VENDORS, async () => {
    const supabase = getSupabaseAdmin()
    
    const { data, error } = await supabase
      .from('contractors')
      .select(`
        *,
        contracts:contracts(id, contract_number, status),
        invoices:invoices(id, invoice_number, status, total_cents)
      `)
      .eq('id', vendorId)
      .single()
    
    if (error) {
      console.error('Get vendor error:', error)
      return { success: false, error: error.message, vendor: null }
    }
    
    return { success: true, vendor: data }
  })
}

// =====================================================
// CREATE VENDOR
// =====================================================

export interface CreateVendorInput {
  company_name: string
  contact_name: string
  email: string
  phone?: string
  address_line1?: string
  city?: string
  province?: string
  postal_code?: string
  business_number?: string
  gst_number?: string
}

/**
 * Create a new vendor/contractor
 * Requires: create_vendors permission
 * Rate limited: 20 actions per minute
 * 
 * Uses enterprise secureAction wrapper with:
 * - RBAC permission enforcement
 * - Rate limiting
 * - Security telemetry logging
 */
export const createVendor = secureAction(
  PERMISSIONS.VENDORS.CREATE_VENDORS,
  async (user, input: CreateVendorInput) => {
    const supabase = getSupabaseAdmin()
    
    // Validate required fields
    if (!input.company_name?.trim()) {
      throw new Error('Company name is required')
    }
    if (!input.contact_name?.trim()) {
      throw new Error('Contact name is required')
    }
    if (!input.email?.trim()) {
      throw new Error('Email is required')
    }
    
    // Get user record
    const { data: userData } = await supabase
      .from('users')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()
    
    // Check for duplicate email
    const { data: existing } = await supabase
      .from('contractors')
      .select('id')
      .eq('email', input.email)
      .single()
    
    if (existing) {
      throw new Error('A vendor with this email already exists')
    }
    
    // Create vendor
    const { data: vendor, error } = await supabase
      .from('contractors')
      .insert({
        company_name: input.company_name.trim(),
        contact_name: input.contact_name.trim(),
        email: input.email.trim().toLowerCase(),
        phone: input.phone?.trim() || null,
        address_line1: input.address_line1?.trim() || null,
        city: input.city?.trim() || null,
        province: input.province || null,
        postal_code: input.postal_code?.trim() || null,
        business_number: input.business_number?.trim() || null,
        status: 'pending_kyc',
        created_by: userData?.id,
      })
      .select()
      .single()
    
    if (error) {
      console.error('Create vendor error:', error)
      throw new Error(error.message)
    }
    
    // Log the action
    if (userData) {
      await supabase.from('audit_logs').insert({
        action: 'vendor_created',
        entity_type: 'contractor',
        entity_id: vendor.id,
        user_id: userData.id,
        details: { company_name: input.company_name },
      })
    }
    
    revalidatePath('/admin/contractors')
    
    return { vendor }
  },
  {
    actionName: 'createVendor',
    module: 'admin/contractors',
    rateLimit: RATE_LIMITS.CREATE_VENDOR,
    isCritical: true,
  }
)

// =====================================================
// EDIT VENDOR
// =====================================================

export interface UpdateVendorInput {
  vendor_id: string
  company_name?: string
  contact_name?: string
  email?: string
  phone?: string
  address_line1?: string
  city?: string
  province?: string
  postal_code?: string
  business_number?: string
  status?: 'active' | 'pending_kyc' | 'suspended' | 'inactive'
  wcb_clearance_expiry?: string
}

/**
 * Update vendor information
 * Requires: edit_vendors permission
 * Rate limited: 20 actions per minute
 * 
 * Uses enterprise secureAction wrapper with:
 * - RBAC permission enforcement
 * - Rate limiting
 * - Security telemetry logging
 */
export const updateVendor = secureAction(
  PERMISSIONS.VENDORS.EDIT_VENDORS,
  async (user, input: UpdateVendorInput) => {
    const supabase = getSupabaseAdmin()
    
    // Get user record
    const { data: userData } = await supabase
      .from('users')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()
    
    // Get current vendor state for audit
    const { data: currentVendor } = await supabase
      .from('contractors')
      .select('*')
      .eq('id', input.vendor_id)
      .single()
    
    if (!currentVendor) {
      throw new Error('Vendor not found')
    }
    
    // Build update object (only include changed fields)
    const updates: Record<string, unknown> = {}
    if (input.company_name !== undefined) updates.company_name = input.company_name.trim()
    if (input.contact_name !== undefined) updates.contact_name = input.contact_name.trim()
    if (input.email !== undefined) updates.email = input.email.trim().toLowerCase()
    if (input.phone !== undefined) updates.phone = input.phone?.trim() || null
    if (input.address_line1 !== undefined) updates.address_line1 = input.address_line1?.trim() || null
    if (input.city !== undefined) updates.city = input.city?.trim() || null
    if (input.province !== undefined) updates.province = input.province || null
    if (input.postal_code !== undefined) updates.postal_code = input.postal_code?.trim() || null
    if (input.business_number !== undefined) updates.business_number = input.business_number?.trim() || null
    if (input.status !== undefined) updates.status = input.status
    if (input.wcb_clearance_expiry !== undefined) updates.wcb_clearance_expiry = input.wcb_clearance_expiry || null
    
    updates.updated_at = new Date().toISOString()
    
    // Update vendor
    const { data: vendor, error } = await supabase
      .from('contractors')
      .update(updates)
      .eq('id', input.vendor_id)
      .select()
      .single()
    
    if (error) {
      console.error('Update vendor error:', error)
      throw new Error(error.message)
    }
    
    // Log the action
    if (userData) {
      await supabase.from('audit_logs').insert({
        action: 'vendor_updated',
        entity_type: 'contractor',
        entity_id: input.vendor_id,
        user_id: userData.id,
        details: { 
          changes: Object.keys(updates).filter(k => k !== 'updated_at'),
          previous_values: currentVendor,
        },
      })
    }
    
    revalidatePath('/admin/contractors')
    revalidatePath(`/admin/contractors/${input.vendor_id}`)
    revalidatePath('/pm/contractors')
    revalidatePath(`/pm/contractors/${input.vendor_id}`)
    
    return { vendor }
  },
  {
    actionName: 'updateVendor',
    module: 'admin/contractors',
    rateLimit: RATE_LIMITS.CREATE_VENDOR,
    isCritical: true,
  }
)

// =====================================================
// DELETE VENDOR (CRITICAL)
// =====================================================

/**
 * Delete a vendor (soft delete - sets status to inactive)
 * Requires: delete_vendors permission (CRITICAL)
 * Rate limited: 10 actions per minute (stricter for delete)
 * 
 * Uses enterprise secureAction wrapper with:
 * - RBAC permission enforcement
 * - Rate limiting
 * - Security telemetry logging
 */
export const deleteVendor = secureAction(
  PERMISSIONS.VENDORS.DELETE_VENDORS,
  async (user, input: { vendorId: string }) => {
    const supabase = getSupabaseAdmin()
    const { vendorId } = input
    
    // Get user record
    const { data: userData } = await supabase
      .from('users')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()
    
    // Get current vendor
    const { data: currentVendor } = await supabase
      .from('contractors')
      .select('company_name')
      .eq('id', vendorId)
      .single()
    
    if (!currentVendor) {
      throw new Error('Vendor not found')
    }
    
    // Check for active invoices
    const { data: activeInvoices } = await supabase
      .from('invoices')
      .select('id')
      .eq('contractor_id', vendorId)
      .in('status', ['submitted', 'pending_approval', 'approved', 'payment_processing'])
      .limit(1)
    
    if (activeInvoices?.length) {
      throw new Error('Cannot delete vendor with active invoices. Please resolve all pending invoices first.')
    }
    
    // Soft delete - set to inactive
    const { error } = await supabase
      .from('contractors')
      .update({ 
        status: 'inactive',
        deleted_at: new Date().toISOString(),
      })
      .eq('id', vendorId)
    
    if (error) {
      console.error('Delete vendor error:', error)
      throw new Error(error.message)
    }
    
    // Log the critical action
    if (userData) {
      await supabase.from('audit_logs').insert({
        action: 'vendor_deleted',
        entity_type: 'contractor',
        entity_id: vendorId,
        user_id: userData.id,
        details: { company_name: currentVendor.company_name },
      })
    }
    
    revalidatePath('/admin/contractors')
    
    return { deleted: true }
  },
  {
    actionName: 'deleteVendor',
    module: 'admin/contractors',
    rateLimit: RATE_LIMITS.EXECUTE_EFT, // Use strictest limit for delete
    isCritical: true,
  }
)

// =====================================================
// INVITE VENDOR TO PORTAL
// =====================================================

export interface ContractorPortalStatus {
  hasLogin: boolean
  pendingInvitation: {
    id: string
    email: string
    expiresAt: string
    createdAt: string
  } | null
}

/**
 * Returns whether a contractor already has a portal login (auth_user_id set)
 * and any outstanding pending invitation.
 * Requires: view_vendors permission
 */
export async function getContractorPortalStatus(
  contractorId: string
): Promise<{ success: boolean; status?: ContractorPortalStatus; error?: string }> {
  return withPermission(PERMISSIONS.VENDORS.VIEW_VENDORS, async () => {
    const supabase = getSupabaseAdmin()

    const { data: contractor, error } = await supabase
      .from('contractors')
      .select('id, auth_user_id')
      .eq('id', contractorId)
      .single()

    if (error || !contractor) {
      return { success: false, error: error?.message || 'Contractor not found' }
    }

    const { data: invitation } = await supabase
      .from('contractor_invitations')
      .select('id, email, expires_at, created_at')
      .eq('contractor_id', contractorId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    return {
      success: true,
      status: {
        hasLogin: !!contractor.auth_user_id,
        pendingInvitation: invitation
          ? {
              id: invitation.id,
              email: invitation.email,
              expiresAt: invitation.expires_at,
              createdAt: invitation.created_at,
            }
          : null,
      },
    }
  })
}

/**
 * Invite a contractor to the vendor portal.
 *
 * Generates a single-use tokenized invitation, persists it, sends an
 * email/WhatsApp invite, and returns the acceptance URL so the admin can
 * also copy it manually. Does NOT create the auth user — that happens when
 * the contractor accepts the invite and sets their password.
 *
 * Requires: edit_vendors permission
 */
export const inviteContractorToPortal = secureAction(
  PERMISSIONS.VENDORS.EDIT_VENDORS,
  async (user, input: { contractorId: string; email?: string }) => {
    const supabase = getSupabaseAdmin()

    // Resolve the inviting user's internal id for audit/linking
    const { data: userData } = await supabase
      .from('users')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()

    const { data: contractor, error: contractorError } = await supabase
      .from('contractors')
      .select('id, company_name, contact_name, email, phone, auth_user_id')
      .eq('id', input.contractorId)
      .single()

    if (contractorError || !contractor) {
      throw new Error('Contractor not found')
    }

    if (contractor.auth_user_id) {
      throw new Error('This contractor already has a portal login')
    }

    const inviteEmail = (input.email?.trim() || contractor.email || '').toLowerCase()
    if (!inviteEmail) {
      throw new Error('No email address available for this contractor')
    }

    // Ensure no other auth user already owns this email
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', inviteEmail)
      .maybeSingle()

    if (existingUser) {
      throw new Error('An account with this email already exists')
    }

    // Invalidate any prior pending invitations for this contractor
    await supabase
      .from('contractor_invitations')
      .update({ status: 'revoked', updated_at: new Date().toISOString() })
      .eq('contractor_id', contractor.id)
      .eq('status', 'pending')

    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: invitation, error: inviteError } = await supabase
      .from('contractor_invitations')
      .insert({
        contractor_id: contractor.id,
        email: inviteEmail,
        invited_by: userData?.id,
        invitation_token: token,
        expires_at: expiresAt,
        status: 'pending',
      })
      .select('id')
      .single()

    if (inviteError) {
      console.error('Create contractor invitation error:', inviteError)
      throw new Error(inviteError.message)
    }

    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
    const inviteUrl = `${baseUrl}/vendor/accept-invite?token=${token}`

    // Send the invitation notification (gracefully simulates if creds missing)
    let notificationSent = false
    try {
      const result = await sendContractorInvitationNotification(
        {
          id: contractor.id,
          email: inviteEmail,
          phone: contractor.phone || undefined,
          name: contractor.contact_name || contractor.company_name,
          role: 'contractor',
        },
        {
          companyName: contractor.company_name,
          inviteUrl,
          expiresAt,
        },
        { contractorId: contractor.id, triggeredBy: userData?.id }
      )
      notificationSent = result.success
    } catch (notifyError) {
      console.error('Contractor invite notification error:', notifyError)
    }

    if (userData) {
      await supabase.from('audit_logs').insert({
        action: 'contractor_invited',
        entity_type: 'contractor',
        entity_id: contractor.id,
        user_id: userData.id,
        details: { email: inviteEmail, invitation_id: invitation.id },
      })
    }

    revalidatePath(`/admin/contractors/${contractor.id}`)

    return { invitationId: invitation.id, inviteUrl, token, notificationSent }
  },
  {
    actionName: 'inviteContractorToPortal',
    module: 'admin/contractors',
    rateLimit: RATE_LIMITS.CREATE_VENDOR,
    isCritical: true,
  }
)
