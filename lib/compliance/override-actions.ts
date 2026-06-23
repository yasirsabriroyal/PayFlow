'use server'

/**
 * Compliance Override Actions
 *
 * Server actions for creating, listing, and expiring compliance overrides.
 * Overrides allow authorized users (admin, accountant) to temporarily bypass
 * a compliance block to release a payment when a valid business reason exists.
 *
 * Security:
 *   - Only admin and accountant roles may create overrides (enforced via RLS + server check)
 *   - Project managers can view but not create overrides
 *   - All create/expire events are fully audit-logged
 *   - Override reasons must be at least 25 characters
 */

import { createClient } from '@/lib/supabase/server'

// ============================================
// TYPES
// ============================================

export interface ComplianceOverride {
  id: string
  contractor_id: string
  invoice_id: string | null
  issue_type: string
  override_reason: string
  approved_by: string
  approved_at: string
  expires_at: string | null
  is_active: boolean
  created_at: string
  // Joined fields
  contractor_name?: string
  invoice_number?: string
  approver_name?: string
}

export interface CreateOverrideInput {
  contractor_id: string
  invoice_id?: string | null
  issue_type: string
  override_reason: string
  /** Optional: ISO datetime after which this override expires. Default = 30 days from now. */
  expires_at?: string | null
}

export type CreateOverrideResult =
  | { success: true; override: ComplianceOverride }
  | { success: false; error: string }

export type ListOverridesResult =
  | { success: true; overrides: ComplianceOverride[] }
  | { success: false; error: string }

// ============================================
// CREATE OVERRIDE
// ============================================

export async function createComplianceOverride(
  input: CreateOverrideInput
): Promise<CreateOverrideResult> {
  const supabase = await createClient()

  // Verify the current user is admin or accountant
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { success: false, error: 'Authentication required.' }
  }

  const { data: currentUser, error: userError } = await supabase
    .from('users')
    .select('id, role, first_name, last_name')
    .eq('auth_user_id', user.id)
    .single()

  if (userError || !currentUser) {
    return { success: false, error: 'User not found.' }
  }

  if (!['admin', 'accountant'].includes(currentUser.role)) {
    return { success: false, error: 'Only administrators and accountants may create compliance overrides.' }
  }

  if (!input.override_reason || input.override_reason.trim().length < 25) {
    return { success: false, error: 'Override reason must be at least 25 characters.' }
  }

  // Default expiry = 30 days from now if not specified
  const expiresAt = input.expires_at !== undefined
    ? input.expires_at
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data: override, error: insertError } = await supabase
    .from('compliance_overrides')
    .insert({
      contractor_id: input.contractor_id,
      invoice_id: input.invoice_id ?? null,
      issue_type: input.issue_type,
      override_reason: input.override_reason.trim(),
      approved_by: currentUser.id,
      approved_at: new Date().toISOString(),
      expires_at: expiresAt,
      is_active: true,
    })
    .select('*')
    .single()

  if (insertError || !override) {
    console.error('[createComplianceOverride] insert error:', insertError)
    return { success: false, error: insertError?.message ?? 'Failed to create override.' }
  }

  // Audit log
  await supabase.from('audit_logs').insert({
    action: 'compliance_override_created',
    entity_type: 'compliance_override',
    entity_id: override.id,
    user_id: currentUser.id,
    description: `Compliance override created for issue: ${input.issue_type}`,
    new_values: {
      contractor_id: input.contractor_id,
      invoice_id: input.invoice_id ?? null,
      issue_type: input.issue_type,
      reason: input.override_reason.trim(),
      expires_at: expiresAt,
      approved_by: `${currentUser.first_name ?? ''} ${currentUser.last_name ?? ''}`.trim(),
    },
  })

  return { success: true, override: override as ComplianceOverride }
}

// ============================================
// EXPIRE / REVOKE OVERRIDE
// ============================================

export async function expireComplianceOverride(
  overrideId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { success: false, error: 'Authentication required.' }
  }

  const { data: currentUser } = await supabase
    .from('users')
    .select('id, role')
    .eq('auth_user_id', user.id)
    .single()

  if (!currentUser || !['admin', 'accountant'].includes(currentUser.role)) {
    return { success: false, error: 'Only administrators and accountants may revoke compliance overrides.' }
  }

  const { error: updateError } = await supabase
    .from('compliance_overrides')
    .update({ is_active: false, expires_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', overrideId)
    .eq('is_active', true)

  if (updateError) {
    return { success: false, error: updateError.message }
  }

  await supabase.from('audit_logs').insert({
    action: 'compliance_override_expired',
    entity_type: 'compliance_override',
    entity_id: overrideId,
    user_id: currentUser.id,
    description: 'Compliance override manually revoked.',
    new_values: { revoked_at: new Date().toISOString() },
  })

  return { success: true }
}

// ============================================
// LIST OVERRIDES — for the compliance dashboard
// ============================================

export interface ListOverridesOptions {
  contractor_id?: string
  invoice_id?: string
  active_only?: boolean
  limit?: number
}

export async function listComplianceOverrides(
  options: ListOverridesOptions = {}
): Promise<ListOverridesResult> {
  const supabase = await createClient()

  let query = supabase
    .from('compliance_overrides')
    .select(`
      id,
      contractor_id,
      invoice_id,
      issue_type,
      override_reason,
      approved_by,
      approved_at,
      expires_at,
      is_active,
      created_at,
      contractors:contractor_id ( company_name, contact_name ),
      invoices:invoice_id ( invoice_number ),
      users:approved_by ( first_name, last_name )
    `)
    .order('created_at', { ascending: false })

  if (options.contractor_id) {
    query = query.eq('contractor_id', options.contractor_id)
  }
  if (options.invoice_id) {
    query = query.eq('invoice_id', options.invoice_id)
  }
  if (options.active_only) {
    query = query.eq('is_active', true)
  }
  if (options.limit) {
    query = query.limit(options.limit)
  }

  const { data, error } = await query

  if (error) {
    return { success: false, error: error.message }
  }

  const overrides: ComplianceOverride[] = (data ?? []).map((row: Record<string, unknown>) => {
    const contractor = row.contractors as { company_name?: string; contact_name?: string } | null
    const invoice = row.invoices as { invoice_number?: string } | null
    const approver = row.users as { first_name?: string; last_name?: string } | null
    return {
      id: row.id as string,
      contractor_id: row.contractor_id as string,
      invoice_id: row.invoice_id as string | null,
      issue_type: row.issue_type as string,
      override_reason: row.override_reason as string,
      approved_by: row.approved_by as string,
      approved_at: row.approved_at as string,
      expires_at: row.expires_at as string | null,
      is_active: row.is_active as boolean,
      created_at: row.created_at as string,
      contractor_name: contractor?.company_name || contractor?.contact_name || undefined,
      invoice_number: invoice?.invoice_number || undefined,
      approver_name: approver
        ? `${approver.first_name ?? ''} ${approver.last_name ?? ''}`.trim() || undefined
        : undefined,
    }
  })

  return { success: true, overrides }
}
