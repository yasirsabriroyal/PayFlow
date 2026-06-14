import 'server-only'
import { cache } from 'react'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/**
 * Tenancy seam
 * ------------
 * PayFlow is single-tenant today but designed to go multi-tenant soon. To avoid
 * a disruptive `organization_id` migration across every table before it is
 * actually needed, all "which organization is this?" logic flows through this
 * ONE module.
 *
 * Today `resolveActiveOrgId()` returns the id of the single default
 * organization row (flagged `is_default`). When per-user membership is
 * introduced, ONLY this module changes (to derive the org from the
 * authenticated session / row), and every caller — branding, templates,
 * distribution, logging — keeps working unchanged.
 *
 * Consumers should treat the returned id as opaque and NEVER hardcode an org id
 * at the call site.
 */

export type OrganizationId = string

/**
 * Fallback identifier used only when the organizations table cannot be read
 * (e.g. very first boot before the Phase 1 migration seeded a default org).
 * Real resolution always prefers the seeded default org's UUID.
 */
export const DEFAULT_ORG_ID = 'default' as const

/** Cached lookup of the single default organization's UUID. */
const getDefaultOrgId = cache(async (): Promise<OrganizationId> => {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const { data, error } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .eq('is_default', true)
      .limit(1)
      .single()
    if (error || !data?.id) return DEFAULT_ORG_ID
    return data.id
  } catch {
    return DEFAULT_ORG_ID
  }
})

/**
 * Resolve the organization id for the current request/context.
 *
 * Single-tenant: the seeded default org. The optional `hint` lets callers that
 * already carry an org id (e.g. the notification distribution layer) pass it
 * through; a provided hint is honored, otherwise the default org is resolved.
 */
export async function resolveActiveOrgId(hint?: string | null): Promise<OrganizationId> {
  if (hint && hint.trim()) return hint
  return getDefaultOrgId()
}
