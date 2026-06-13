/**
 * Centralized invoice status transition engine.
 *
 * Every invoice status change MUST go through `applyInvoiceStatusChange` so that
 * the following side effects happen consistently regardless of which portal or
 * action triggered the change:
 *   1. Transition validation (only allowed old -> new moves)
 *   2. invoices table update (status + any reject/dispute metadata)
 *   3. audit_logs row
 *   4. invoice_status_history row
 *   5. In-app notifications (always) + email/WhatsApp (when keys configured)
 *
 * This module runs server-side only (uses the Supabase service-role admin client).
 */

import 'server-only'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import {
  sendNotificationToRecipient,
  type InAppNotificationType,
} from '@/lib/notifications/server-dispatch'

export type InvoiceStatus =
  | 'draft'
  | 'submitted'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'disputed'
  | 'partially_paid'
  | 'paid'

/**
 * Allowed transitions. Key = current status, value = set of statuses it may move to.
 * Kept deliberately strict so invalid jumps (e.g. paid -> submitted) are rejected.
 */
const ALLOWED_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ['submitted', 'pending_approval'],
  submitted: ['pending_approval', 'approved', 'rejected', 'disputed'],
  pending_approval: ['approved', 'rejected', 'disputed'],
  approved: ['paid', 'partially_paid', 'disputed', 'rejected'],
  rejected: ['pending_approval'], // allow re-open back into review
  disputed: ['pending_approval', 'approved', 'rejected'],
  partially_paid: ['paid', 'disputed'],
  paid: [], // terminal
}

export interface StatusChangeActor {
  /** internal users.id (preferred) */
  userId: string | null
  name: string
  role: string
  /** raw auth user id, used to exclude the actor from their own notifications */
  authUserId?: string
}

export interface StatusChangeInput {
  invoiceId: string
  newStatus: InvoiceStatus
  actor: StatusChangeActor
  /** Optional reason/notes (required for reject + dispute by callers) */
  reason?: string
  /** Extra column updates to apply alongside status (e.g. reject/dispute metadata) */
  extraInvoiceUpdates?: Record<string, unknown>
}

export interface StatusChangeResult {
  invoice: Record<string, unknown>
  oldStatus: string | null
  newStatus: InvoiceStatus
}

const AUDIT_ACTION_BY_STATUS: Record<InvoiceStatus, string> = {
  draft: 'invoice_updated',
  submitted: 'invoice_submitted',
  pending_approval: 'invoice_submitted',
  approved: 'invoice_approved',
  rejected: 'invoice_rejected',
  disputed: 'invoice_disputed',
  partially_paid: 'invoice_paid',
  paid: 'invoice_paid',
}

/**
 * Validate whether a transition is allowed. Exposed for callers/tests.
 */
export function isTransitionAllowed(from: string | null, to: InvoiceStatus): boolean {
  if (!from) return true // first transition (no prior status)
  if (from === to) return false
  const allowed = ALLOWED_TRANSITIONS[from as InvoiceStatus]
  if (!allowed) return true // unknown source status -> don't block legacy data
  return allowed.includes(to)
}

/**
 * Apply an invoice status change with full side effects.
 * Throws on validation failure or DB error so callers can surface the message.
 */
export async function applyInvoiceStatusChange(
  input: StatusChangeInput
): Promise<StatusChangeResult> {
  const { invoiceId, newStatus, actor, reason, extraInvoiceUpdates } = input
  const supabase = getSupabaseAdmin()

  // 1. Load current invoice (status + routing fields)
  const { data: current, error: loadError } = await supabase
    .from('invoices')
    .select('id, status, invoice_number, total_cents, contractor_id, project_id')
    .eq('id', invoiceId)
    .single()

  if (loadError || !current) {
    throw new Error('Invoice not found')
  }

  const oldStatus = (current.status as string | null) ?? null

  // 2. Validate transition
  if (!isTransitionAllowed(oldStatus, newStatus)) {
    throw new Error(
      `Invalid status transition: ${oldStatus ?? 'none'} -> ${newStatus}`
    )
  }

  // 3. Update invoice
  const { data: invoice, error: updateError } = await supabase
    .from('invoices')
    .update({ status: newStatus, ...(extraInvoiceUpdates ?? {}) })
    .eq('id', invoiceId)
    .select()
    .single()

  if (updateError) {
    console.error('[status-flow] invoice update failed:', updateError)
    throw new Error(updateError.message)
  }

  // 4. Audit log (best-effort — never block the transition)
  try {
    await supabase.from('audit_logs').insert({
      action: AUDIT_ACTION_BY_STATUS[newStatus] ?? 'invoice_updated',
      entity_type: 'invoice',
      entity_id: invoiceId,
      user_id: actor.userId,
      user_role: actor.role,
      description: reason ?? null,
      old_values: { status: oldStatus },
      new_values: { status: newStatus, reason: reason ?? null },
    })
  } catch (e) {
    console.error('[status-flow] audit log failed:', e)
  }

  // 5. Status history (best-effort)
  try {
    await supabase.from('invoice_status_history').insert({
      invoice_id: invoiceId,
      old_status: oldStatus,
      new_status: newStatus,
      changed_by_user_id: actor.userId,
      changed_by_name: actor.name,
      changed_by_role: actor.role,
      reason: reason ?? null,
    })
  } catch (e) {
    console.error('[status-flow] status history insert failed:', e)
  }

  // 6. Notifications (best-effort — never block the transition)
  try {
    await dispatchStatusNotifications({
      invoiceId,
      invoiceNumber: (current.invoice_number as string) ?? invoiceId,
      totalCents: (current.total_cents as number) ?? 0,
      contractorId: current.contractor_id as string | null,
      projectId: current.project_id as string | null,
      newStatus,
      reason,
      actor,
    })
  } catch (e) {
    console.error('[status-flow] notification dispatch failed:', e)
  }

  return { invoice, oldStatus, newStatus }
}

// ============================================
// Notification routing
// ============================================

interface DispatchInput {
  invoiceId: string
  invoiceNumber: string
  totalCents: number
  contractorId: string | null
  projectId: string | null
  newStatus: InvoiceStatus
  reason?: string
  actor: StatusChangeActor
}

interface ResolvedRecipient {
  userId: string
  name: string
  email: string | null
  phone: string | null
  role: string
  emailEnabled: boolean
  whatsAppEnabled: boolean
}

/**
 * Per-status recipient role routing (staff side). Contractor is resolved separately.
 */
const STAFF_RECIPIENTS_BY_STATUS: Record<InvoiceStatus, Array<'admin' | 'accountant' | 'project_manager'>> = {
  draft: [],
  submitted: ['accountant', 'admin'], // + assigned PM (resolved separately)
  pending_approval: ['accountant', 'admin'],
  approved: ['accountant'], // + assigned PM, + contractor
  rejected: [], // + assigned PM, + contractor
  disputed: ['accountant', 'admin'], // + assigned PM
  partially_paid: ['admin'], // + assigned PM, + contractor
  paid: ['admin'], // + assigned PM, + contractor
}

function statusToInAppType(status: InvoiceStatus): InAppNotificationType {
  switch (status) {
    case 'submitted':
    case 'pending_approval':
      return 'invoice_submitted'
    case 'approved':
      return 'invoice_approved'
    case 'rejected':
      return 'invoice_rejected'
    case 'disputed':
      return 'invoice_disputed'
    case 'paid':
    case 'partially_paid':
      return 'invoice_paid'
    default:
      return 'invoice_submitted'
  }
}

function buildMessage(
  status: InvoiceStatus,
  invoiceNumber: string,
  amount: string,
  reason?: string
): { title: string; body: string } {
  switch (status) {
    case 'submitted':
    case 'pending_approval':
      return { title: `Invoice ${invoiceNumber} submitted`, body: `A new invoice for ${amount} is awaiting review.` }
    case 'approved':
      return { title: `Invoice ${invoiceNumber} approved`, body: `Invoice for ${amount} has been approved for payment.` }
    case 'rejected':
      return { title: `Invoice ${invoiceNumber} rejected`, body: reason ? `Rejected: ${reason}` : `Invoice for ${amount} was rejected.` }
    case 'disputed':
      return { title: `Invoice ${invoiceNumber} disputed`, body: reason ? `Disputed: ${reason}` : `Invoice for ${amount} has been flagged as disputed.` }
    case 'partially_paid':
      return { title: `Invoice ${invoiceNumber} partially paid`, body: `A partial payment was recorded for invoice ${invoiceNumber}.` }
    case 'paid':
      return { title: `Invoice ${invoiceNumber} paid`, body: `Payment of ${amount} has been processed.` }
    default:
      return { title: `Invoice ${invoiceNumber} updated`, body: `Invoice status changed to ${status}.` }
  }
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format((cents ?? 0) / 100)
}

async function dispatchStatusNotifications(input: DispatchInput): Promise<void> {
  const supabase = getSupabaseAdmin()
  const { newStatus, invoiceNumber, totalCents, contractorId, projectId, reason, actor } = input

  const amount = formatCents(totalCents)
  const { title, body } = buildMessage(newStatus, invoiceNumber, amount, reason)
  const type = statusToInAppType(newStatus)
  const link = `/invoices/${input.invoiceId}`

  const recipients = new Map<string, ResolvedRecipient>()

  // --- Staff recipients by role ---
  const staffRoles = STAFF_RECIPIENTS_BY_STATUS[newStatus] ?? []
  if (staffRoles.length > 0) {
    const { data: staff } = await supabase
      .from('users')
      .select('id, email, phone, first_name, last_name, role, notification_email, notification_phone, email_notifications_enabled, whatsapp_notifications_enabled, is_active')
      .in('role', staffRoles)
      .eq('is_active', true)

    for (const u of staff ?? []) {
      recipients.set(u.id, {
        userId: u.id,
        name: `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || 'User',
        email: u.notification_email || u.email,
        phone: u.notification_phone || u.phone,
        role: u.role,
        emailEnabled: u.email_notifications_enabled ?? true,
        whatsAppEnabled: u.whatsapp_notifications_enabled ?? true,
      })
    }
  }

  // --- Assigned PM(s) for the project ---
  const pmStatuses: InvoiceStatus[] = ['submitted', 'pending_approval', 'approved', 'rejected', 'disputed', 'paid', 'partially_paid']
  if (projectId && pmStatuses.includes(newStatus)) {
    const { data: assignments } = await supabase
      .from('project_assignments')
      .select('user_id, users:user_id (id, email, phone, first_name, last_name, role, notification_email, notification_phone, email_notifications_enabled, whatsapp_notifications_enabled, is_active)')
      .eq('project_id', projectId)

    for (const a of assignments ?? []) {
      const u = (a as { users?: Record<string, unknown> }).users
      if (u && u.is_active && u.role === 'project_manager') {
        recipients.set(u.id as string, {
          userId: u.id as string,
          name: `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || 'Project Manager',
          email: (u.notification_email as string) || (u.email as string),
          phone: (u.notification_phone as string) || (u.phone as string),
          role: u.role as string,
          emailEnabled: (u.email_notifications_enabled as boolean) ?? true,
          whatsAppEnabled: (u.whatsapp_notifications_enabled as boolean) ?? true,
        })
      }
    }
  }

  // --- Contractor (for approved / rejected / paid / partially_paid) ---
  const contractorStatuses: InvoiceStatus[] = ['approved', 'rejected', 'paid', 'partially_paid']
  if (contractorId && contractorStatuses.includes(newStatus)) {
    const { data: contractor } = await supabase
      .from('contractors')
      .select('id, auth_user_id, company_name, contact_name, email, phone')
      .eq('id', contractorId)
      .single()

    if (contractor) {
      // Map to a users row for in-app delivery (if the contractor has portal access)
      let contractorUserId: string | null = null
      if (contractor.auth_user_id) {
        const { data: cu } = await supabase
          .from('users')
          .select('id, email_notifications_enabled, whatsapp_notifications_enabled')
          .eq('auth_user_id', contractor.auth_user_id)
          .maybeSingle()
        contractorUserId = cu?.id ?? null

        if (contractorUserId) {
          recipients.set(contractorUserId, {
            userId: contractorUserId,
            name: contractor.contact_name || contractor.company_name || 'Contractor',
            email: contractor.email,
            phone: contractor.phone,
            role: 'contractor',
            emailEnabled: cu?.email_notifications_enabled ?? true,
            whatsAppEnabled: cu?.whatsapp_notifications_enabled ?? true,
          })
        }
      }

      // Contractor without portal account: still send email/WhatsApp (no in-app row)
      if (!contractorUserId && (contractor.email || contractor.phone)) {
        await sendNotificationToRecipient({
          recipientUserId: null,
          recipient: {
            id: contractor.id,
            name: contractor.contact_name || contractor.company_name || 'Contractor',
            email: contractor.email ?? undefined,
            phone: contractor.phone ?? undefined,
            role: 'contractor',
          },
          type,
          title,
          body,
          link,
          invoiceId: input.invoiceId,
          context: { invoiceId: input.invoiceId, contractorId: contractor.id, projectId: projectId ?? undefined, triggeredBy: actor.userId ?? undefined },
        })
      }
    }
  }

  // --- Exclude the actor from their own notifications ---
  if (actor.userId) recipients.delete(actor.userId)

  // --- Fan out to all resolved (users-table) recipients ---
  await Promise.all(
    Array.from(recipients.values()).map((r) =>
      sendNotificationToRecipient({
        recipientUserId: r.userId,
        recipient: {
          id: r.userId,
          name: r.name,
          email: r.email ?? undefined,
          phone: r.phone ?? undefined,
          role: r.role as 'admin' | 'accountant' | 'project_manager' | 'contractor',
          emailEnabled: r.emailEnabled,
          whatsAppEnabled: r.whatsAppEnabled,
        },
        type,
        title,
        body,
        link,
        invoiceId: input.invoiceId,
        context: { invoiceId: input.invoiceId, contractorId: contractorId ?? undefined, projectId: projectId ?? undefined, triggeredBy: actor.userId ?? undefined },
      })
    )
  )
}
