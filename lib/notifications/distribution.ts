/**
 * Tenant-ready notification distribution framework.
 *
 * Resolves WHO should receive a notification for a given invoice/payment event,
 * driven entirely by configuration rather than hardcoded recipient lists. This
 * is the single source of truth for recipient routing and is consumed by the
 * invoice status engine (`lib/invoices/status-flow.ts`).
 *
 * Design goals:
 *   - No hardcoded recipients — rules live in `system_settings`.
 *   - Supports role-based, user-based (named individuals, e.g. a Controller),
 *     project-role (the assigned PM), and the vendor/contractor themselves.
 *   - `organizationId` is accepted today (currently always the global policy)
 *     so per-tenant rules can be layered in later WITHOUT touching call sites
 *     once an `organizations` table exists.
 *
 * Server-only: uses the Supabase service-role admin client.
 */

import 'server-only'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/** Events map 1:1 to invoice statuses that produce notifications. */
export type DistributionEvent =
  | 'submitted'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'revision_requested'
  | 'disputed'
  | 'partially_paid'
  | 'paid'

/**
 * A single recipient rule. `role` is intentionally a string (not a closed
 * union) so future roles (e.g. 'controller') can be added via config alone.
 */
export type RecipientRule =
  | { kind: 'vendor' }
  | { kind: 'role'; role: string }
  | { kind: 'project_role'; role: string }
  | { kind: 'user'; userId: string }

export interface EventPolicy {
  rules: RecipientRule[]
}

export interface DistributionPolicy {
  version: number
  description?: string
  events: Partial<Record<DistributionEvent, EventPolicy>>
}

export interface ResolvedRecipient {
  /** users.id for the in-app feed; null = external-only recipient (vendor without portal). */
  userId: string | null
  contractorId: string | null
  name: string
  email: string | null
  phone: string | null
  /** 'admin' | 'accountant' | 'project_manager' | 'contractor' | future role string */
  role: string
  emailEnabled: boolean
  smsEnabled: boolean
  whatsAppEnabled: boolean
}

export interface ResolveRecipientsArgs {
  event: DistributionEvent
  /** Reserved for per-tenant policies; currently resolves the global policy. */
  organizationId?: string | null
  contractorId?: string | null
  projectId?: string | null
  /** Internal users.id of the actor — excluded from their own notifications. */
  actorUserId?: string | null
}

/**
 * Built-in fallback used when no `system_settings` policy row exists. Mirrors
 * the historical routing, plus copies payment events to the accountant.
 */
const DEFAULT_POLICY: DistributionPolicy = {
  version: 1,
  events: {
    submitted: { rules: [{ kind: 'role', role: 'accountant' }, { kind: 'role', role: 'admin' }, { kind: 'project_role', role: 'project_manager' }] },
    pending_approval: { rules: [{ kind: 'role', role: 'accountant' }, { kind: 'role', role: 'admin' }, { kind: 'project_role', role: 'project_manager' }] },
    approved: { rules: [{ kind: 'role', role: 'accountant' }, { kind: 'project_role', role: 'project_manager' }, { kind: 'vendor' }] },
    rejected: { rules: [{ kind: 'project_role', role: 'project_manager' }, { kind: 'vendor' }] },
    revision_requested: { rules: [{ kind: 'vendor' }] },
    disputed: { rules: [{ kind: 'role', role: 'accountant' }, { kind: 'role', role: 'admin' }, { kind: 'project_role', role: 'project_manager' }] },
    partially_paid: { rules: [{ kind: 'vendor' }, { kind: 'role', role: 'accountant' }, { kind: 'role', role: 'admin' }, { kind: 'project_role', role: 'project_manager' }] },
    paid: { rules: [{ kind: 'vendor' }, { kind: 'role', role: 'accountant' }, { kind: 'role', role: 'admin' }, { kind: 'project_role', role: 'project_manager' }] },
  },
}

const USER_FIELDS =
  'id, email, phone, first_name, last_name, role, notification_email, notification_phone, email_notifications_enabled, sms_notifications_enabled, whatsapp_notifications_enabled, is_active'

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>

/**
 * Load the active distribution policy. Today this returns the single global
 * policy; `organizationId` is plumbed through for future per-tenant overrides.
 */
export async function getDistributionPolicy(
  _organizationId?: string | null
): Promise<DistributionPolicy> {
  try {
    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('system_settings')
      .select('setting_value')
      .eq('setting_key', 'notification_distribution')
      .eq('is_active', true)
      .maybeSingle()

    const value = data?.setting_value as DistributionPolicy | undefined
    if (value && value.events) return value
  } catch (e) {
    console.error('[distribution] failed to load policy, using default:', e)
  }
  return DEFAULT_POLICY
}

function mapUserRow(u: Record<string, unknown>): ResolvedRecipient {
  return {
    userId: u.id as string,
    contractorId: null,
    name: `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || 'User',
    email: (u.notification_email as string) || (u.email as string) || null,
    phone: (u.notification_phone as string) || (u.phone as string) || null,
    role: u.role as string,
    emailEnabled: (u.email_notifications_enabled as boolean) ?? true,
    smsEnabled: (u.sms_notifications_enabled as boolean) ?? true,
    whatsAppEnabled: (u.whatsapp_notifications_enabled as boolean) ?? false,
  }
}

/** Dedupe key: internal users dedupe by id, external vendors by contractor id. */
function recipientKey(r: ResolvedRecipient): string {
  return r.userId ? `user:${r.userId}` : `contractor:${r.contractorId}`
}

async function resolveRoleRecipients(
  supabase: SupabaseAdmin,
  role: string
): Promise<ResolvedRecipient[]> {
  const { data } = await supabase
    .from('users')
    .select(USER_FIELDS)
    .eq('role', role)
    .eq('is_active', true)
  return (data ?? []).map(mapUserRow)
}

async function resolveUserRecipient(
  supabase: SupabaseAdmin,
  userId: string
): Promise<ResolvedRecipient[]> {
  const { data } = await supabase
    .from('users')
    .select(USER_FIELDS)
    .eq('id', userId)
    .eq('is_active', true)
    .maybeSingle()
  return data ? [mapUserRow(data)] : []
}

async function resolveProjectRoleRecipients(
  supabase: SupabaseAdmin,
  projectId: string,
  role: string
): Promise<ResolvedRecipient[]> {
  const { data: assignments } = await supabase
    .from('project_assignments')
    .select(`user_id, users:user_id (${USER_FIELDS})`)
    .eq('project_id', projectId)

  const out: ResolvedRecipient[] = []
  for (const a of assignments ?? []) {
    const raw = (a as { users?: unknown }).users
    const u = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined
    if (u && u.is_active && u.role === role) out.push(mapUserRow(u))
  }
  return out
}

async function resolveVendorRecipient(
  supabase: SupabaseAdmin,
  contractorId: string
): Promise<ResolvedRecipient[]> {
  const { data: contractor } = await supabase
    .from('contractors')
    .select('id, auth_user_id, company_name, contact_name, email, phone')
    .eq('id', contractorId)
    .maybeSingle()
  if (!contractor) return []

  const name = contractor.contact_name || contractor.company_name || 'Contractor'

  // Portal vendor → has a users row, so they also get an in-app notification.
  if (contractor.auth_user_id) {
    const { data: cu } = await supabase
      .from('users')
      .select('id, email_notifications_enabled, sms_notifications_enabled, whatsapp_notifications_enabled')
      .eq('auth_user_id', contractor.auth_user_id)
      .maybeSingle()
    if (cu?.id) {
      return [{
        userId: cu.id,
        contractorId: contractor.id,
        name,
        email: contractor.email ?? null,
        phone: contractor.phone ?? null,
        role: 'contractor',
        emailEnabled: cu.email_notifications_enabled ?? true,
        smsEnabled: cu.sms_notifications_enabled ?? true,
        whatsAppEnabled: cu.whatsapp_notifications_enabled ?? false,
      }]
    }
  }

  // Non-portal vendor → email/SMS only (no in-app row).
  if (contractor.email || contractor.phone) {
    return [{
      userId: null,
      contractorId: contractor.id,
      name,
      email: contractor.email ?? null,
      phone: contractor.phone ?? null,
      role: 'contractor',
      emailEnabled: true,
      smsEnabled: true,
      whatsAppEnabled: false,
    }]
  }
  return []
}

/**
 * Resolve the deduped recipient set for an event from the configured policy.
 * Never throws — returns an empty array on failure so dispatch can continue.
 */
export async function resolveRecipients(
  args: ResolveRecipientsArgs
): Promise<ResolvedRecipient[]> {
  const { event, organizationId, contractorId, projectId, actorUserId } = args
  const policy = await getDistributionPolicy(organizationId)
  const eventPolicy = policy.events[event]
  if (!eventPolicy || eventPolicy.rules.length === 0) return []

  const supabase = getSupabaseAdmin()
  const deduped = new Map<string, ResolvedRecipient>()

  for (const rule of eventPolicy.rules) {
    let resolved: ResolvedRecipient[] = []
    try {
      if (rule.kind === 'role') {
        resolved = await resolveRoleRecipients(supabase, rule.role)
      } else if (rule.kind === 'user') {
        resolved = await resolveUserRecipient(supabase, rule.userId)
      } else if (rule.kind === 'project_role') {
        if (projectId) resolved = await resolveProjectRoleRecipients(supabase, projectId, rule.role)
      } else if (rule.kind === 'vendor') {
        if (contractorId) resolved = await resolveVendorRecipient(supabase, contractorId)
      }
    } catch (e) {
      console.error('[distribution] rule resolution failed:', rule, e)
    }

    for (const r of resolved) {
      // Exclude the actor from their own notifications.
      if (r.userId && actorUserId && r.userId === actorUserId) continue
      deduped.set(recipientKey(r), r)
    }
  }

  return Array.from(deduped.values())
}
