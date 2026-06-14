import 'server-only'
import { resolveActiveOrg, type OrganizationId } from '@/lib/tenancy'

/**
 * Plan entitlements
 * -----------------
 * The SINGLE authoritative mapping of "what does each plan unlock". Every
 * feature gate in the app should read from here rather than checking plan
 * strings inline, so pricing/packaging changes happen in one place.
 *
 * Today the only gated capability is white-label email (removing the
 * "Powered by PayFlow" footer), but the shape is intentionally extensible.
 */

/** Known plan identifiers. Unknown/empty plans fall back to `standard`. */
export type PlanId = 'standard' | 'professional' | 'enterprise'

export interface Entitlements {
  /** Allowed to remove the "Powered by PayFlow" footer from outbound emails. */
  whiteLabel: boolean
}

/** Per-plan capability matrix. */
export const PLAN_ENTITLEMENTS: Record<PlanId, Entitlements> = {
  standard: { whiteLabel: false },
  professional: { whiteLabel: true },
  enterprise: { whiteLabel: true },
}

/** Human-friendly label for a plan id (for admin UI). */
export const PLAN_LABELS: Record<PlanId, string> = {
  standard: 'Standard',
  professional: 'Professional',
  enterprise: 'Enterprise',
}

const FALLBACK_PLAN: PlanId = 'standard'

/** Normalize an arbitrary stored plan string to a known PlanId. */
export function normalizePlan(plan: string | null | undefined): PlanId {
  const key = (plan ?? '').trim().toLowerCase()
  return (key in PLAN_ENTITLEMENTS ? key : FALLBACK_PLAN) as PlanId
}

/**
 * Pure plan → entitlements lookup. Use this when the plan is already known
 * (e.g. inside the branding resolver, which has already loaded the org) to
 * avoid an extra database round-trip.
 */
export function entitlementsForPlan(plan: string | null | undefined): Entitlements {
  return PLAN_ENTITLEMENTS[normalizePlan(plan)]
}

export interface OrgEntitlements {
  plan: PlanId
  planLabel: string
  entitlements: Entitlements
}

/**
 * Resolve the active organization's plan and its entitlements. Never throws;
 * falls back to the Standard plan when the org cannot be read.
 */
export async function getOrgEntitlements(orgId?: OrganizationId | null): Promise<OrgEntitlements> {
  const org = await resolveActiveOrg(orgId)
  const plan = normalizePlan(org?.plan)
  return { plan, planLabel: PLAN_LABELS[plan], entitlements: PLAN_ENTITLEMENTS[plan] }
}
