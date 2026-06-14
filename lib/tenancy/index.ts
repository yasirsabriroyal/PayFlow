import 'server-only'

/**
 * Tenancy seam
 * ------------
 * PayFlow is single-tenant today but designed to go multi-tenant soon. To avoid
 * a disruptive `organization_id` migration across every table before it is
 * actually needed, all "which organization is this?" logic flows through this
 * ONE module.
 *
 * Today `resolveActiveOrgId()` always returns {@link DEFAULT_ORG_ID}. When a real
 * `organizations` table and per-user membership are introduced, ONLY this module
 * changes (to derive the org from the authenticated session / row), and every
 * caller — branding, templates, distribution, logging — keeps working unchanged.
 *
 * Consumers should treat the returned id as opaque and NEVER hardcode
 * DEFAULT_ORG_ID at the call site.
 */

/**
 * Stable identifier for the single default organization in the current
 * single-tenant deployment. Used as the org key for branding, templates and
 * communication logs until true multi-tenancy lands.
 */
export const DEFAULT_ORG_ID = 'default' as const

export type OrganizationId = string

/**
 * Resolve the organization id for the current request/context.
 *
 * Single-tenant: always the default org. The optional `hint` lets callers that
 * already carry an org id (e.g. the notification distribution layer) pass it
 * through; today a provided hint is honored, otherwise the default is used.
 */
export async function resolveActiveOrgId(hint?: string | null): Promise<OrganizationId> {
  return hint && hint.trim() ? hint : DEFAULT_ORG_ID
}

/** Synchronous variant for code paths that cannot await (rare). */
export function resolveActiveOrgIdSync(hint?: string | null): OrganizationId {
  return hint && hint.trim() ? hint : DEFAULT_ORG_ID
}
