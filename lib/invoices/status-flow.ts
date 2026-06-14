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
import { resolveRecipients, type DistributionEvent } from '@/lib/notifications/distribution'
import { resolveRenderedTemplate } from '@/lib/email/templates/resolve'
import { getTemplateDefinition, type TemplateKey } from '@/lib/email/templates/catalog'
import type { EmailDetailRow } from '@/emails/notification-email'

/**
 * Optional payment metadata used to enrich `paid` / `partially_paid`
 * notifications (and to link the resulting communication records to the
 * payment). Passed by the payment server actions.
 */
export interface PaymentNotificationContext {
  paymentId?: string
  paymentDate?: string
  paymentReference?: string
  paymentMethod?: string
  issuedByName?: string
  amountPaidCents?: number
  receiptUrl?: string
}

export type InvoiceStatus =
  | 'draft'
  | 'submitted'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'revision_requested'
  | 'disputed'
  | 'partially_paid'
  | 'paid'

/**
 * Allowed transitions. Key = current status, value = set of statuses it may move to.
 * Kept deliberately strict so invalid jumps (e.g. paid -> submitted) are rejected.
 */
const ALLOWED_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ['submitted', 'pending_approval'],
  submitted: ['pending_approval', 'approved', 'rejected', 'revision_requested', 'disputed'],
  pending_approval: ['approved', 'rejected', 'revision_requested', 'disputed'],
  approved: ['paid', 'partially_paid', 'disputed', 'rejected'],
  rejected: ['pending_approval'], // allow re-open back into review
  // Contractor resubmits a sent-back invoice; staff may also re-open it directly.
  revision_requested: ['submitted', 'pending_approval'],
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
  /** Reserved for per-tenant distribution policies (currently global). */
  organizationId?: string | null
  /** Payment metadata used to enrich + link `paid`/`partially_paid` notifications. */
  paymentContext?: PaymentNotificationContext
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
  revision_requested: 'invoice_revision_requested',
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
  const { invoiceId, newStatus, actor, reason, extraInvoiceUpdates, organizationId, paymentContext } = input
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
      organizationId,
      payment: paymentContext,
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
  organizationId?: string | null
  payment?: PaymentNotificationContext
}

interface PaidEnrichment {
  vendorName?: string
  projectName?: string
  paymentDate?: string
  paymentReference?: string
  paymentMethod?: string
  issuedByName?: string
  receiptUrl?: string
  /** Amount settled in this transaction (cents). */
  amountPaidCents?: number
  /** Outstanding balance on the invoice after this payment (cents). */
  remainingCents?: number
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
    case 'revision_requested':
      return 'invoice_revision_requested'
    case 'disputed':
      return 'invoice_disputed'
    case 'paid':
    case 'partially_paid':
      return 'invoice_paid'
    default:
      return 'invoice_submitted'
  }
}

/**
 * Detailed paid/partially_paid body. Internal copies (PM/Accountant/Admin) see
 * vendor, project, payment date, reference, method, and who issued the payment.
 */
function buildPaidBody(invoiceNumber: string, amount: string, e?: PaidEnrichment): string {
  const lines = [`Payment of ${amount} has been processed for invoice ${invoiceNumber}.`]
  if (e?.vendorName) lines.push(`Vendor: ${e.vendorName}`)
  if (e?.projectName) lines.push(`Project: ${e.projectName}`)
  if (e?.paymentDate) lines.push(`Payment date: ${e.paymentDate}`)
  if (e?.paymentReference) lines.push(`Reference: ${e.paymentReference}`)
  if (e?.paymentMethod) lines.push(`Method: ${e.paymentMethod.toUpperCase()}`)
  if (e?.issuedByName) lines.push(`Issued by: ${e.issuedByName}`)
  if (e?.receiptUrl) lines.push(`Receipt: ${e.receiptUrl}`)
  return lines.join('\n')
}

function buildMessage(
  status: InvoiceStatus,
  invoiceNumber: string,
  amount: string,
  reason?: string,
  enrichment?: PaidEnrichment
): { title: string; body: string } {
  switch (status) {
    case 'submitted':
    case 'pending_approval':
      return { title: `Invoice ${invoiceNumber} submitted`, body: `A new invoice for ${amount} is awaiting review.` }
    case 'approved':
      return { title: `Invoice ${invoiceNumber} approved`, body: `Invoice for ${amount} has been approved for payment.` }
    case 'rejected':
      return { title: `Invoice ${invoiceNumber} rejected`, body: reason ? `Rejected: ${reason}` : `Invoice for ${amount} was rejected.` }
    case 'revision_requested':
      return {
        title: `Invoice ${invoiceNumber} needs revision`,
        body: reason
          ? `Changes requested: ${reason}`
          : `Invoice for ${amount} was sent back for revision. Please review and resubmit.`,
      }
    case 'disputed':
      return { title: `Invoice ${invoiceNumber} disputed`, body: reason ? `Disputed: ${reason}` : `Invoice for ${amount} has been flagged as disputed.` }
    case 'partially_paid':
      return { title: `Invoice ${invoiceNumber} partially paid`, body: buildPaidBody(invoiceNumber, amount, enrichment) }
    case 'paid':
      return { title: `Invoice ${invoiceNumber} paid`, body: buildPaidBody(invoiceNumber, amount, enrichment) }
    default:
      return { title: `Invoice ${invoiceNumber} updated`, body: `Invoice status changed to ${status}.` }
  }
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format((cents ?? 0) / 100)
}

/**
 * Load vendor + project names to enrich paid/partially_paid notifications.
 * Only runs for payment events that carry a payment context.
 */
async function buildPaymentEnrichment(
  status: InvoiceStatus,
  contractorId: string | null,
  projectId: string | null,
  payment?: PaymentNotificationContext,
  invoiceId?: string
): Promise<PaidEnrichment | undefined> {
  if ((status !== 'paid' && status !== 'partially_paid') || !payment) return undefined
  const supabase = getSupabaseAdmin()

  let vendorName: string | undefined
  let projectName: string | undefined
  if (contractorId) {
    const { data } = await supabase
      .from('contractors')
      .select('company_name, contact_name')
      .eq('id', contractorId)
      .maybeSingle()
    vendorName = data?.company_name || data?.contact_name || undefined
  }
  if (projectId) {
    const { data } = await supabase.from('projects').select('name').eq('id', projectId).maybeSingle()
    projectName = data?.name || undefined
  }

  // Outstanding balance after this payment (best-effort; never blocks the email).
  let remainingCents: number | undefined
  if (invoiceId) {
    const { data: inv } = await supabase
      .from('invoices')
      .select('amount_remaining_cents')
      .eq('id', invoiceId)
      .maybeSingle()
    if (inv && typeof inv.amount_remaining_cents === 'number') {
      remainingCents = inv.amount_remaining_cents
    }
  }

  return {
    vendorName,
    projectName,
    paymentDate: payment.paymentDate,
    paymentReference: payment.paymentReference,
    paymentMethod: payment.paymentMethod,
    issuedByName: payment.issuedByName,
    receiptUrl: payment.receiptUrl,
    amountPaidCents: payment.amountPaidCents,
    remainingCents,
  }
}

/**
 * Send a branded payment-confirmation notification WITHOUT running a status
 * transition. Used by payment server actions (e.g. EFT batch execution) that
 * update invoice status directly — including via the `payment_processing`
 * intermediate state that is outside the strict status state machine — but
 * still need the same branded, real-recipient confirmation (vendor + internal
 * CC) and audit logging that `applyInvoiceStatusChange` produces for `paid`.
 *
 * Never throws: a notification failure must never roll back a completed payment.
 */
export async function dispatchPaymentConfirmation(input: {
  invoiceId: string
  invoiceNumber: string
  totalCents: number
  contractorId: string | null
  projectId: string | null
  /** 'paid' for a full settlement, 'partially_paid' otherwise. */
  status: Extract<InvoiceStatus, 'paid' | 'partially_paid'>
  actor: StatusChangeActor
  organizationId?: string | null
  payment?: PaymentNotificationContext
}): Promise<void> {
  try {
    await dispatchStatusNotifications({
      invoiceId: input.invoiceId,
      invoiceNumber: input.invoiceNumber,
      totalCents: input.totalCents,
      contractorId: input.contractorId,
      projectId: input.projectId,
      newStatus: input.status,
      actor: input.actor,
      organizationId: input.organizationId ?? null,
      payment: input.payment,
    })
  } catch (e) {
    console.error('[status-flow] dispatchPaymentConfirmation failed (non-fatal):', e)
  }
}

/**
 * Fan out a status-change notification. Recipient routing is fully delegated to
 * the configurable distribution framework (`resolveRecipients`), making it
 * tenant-ready and free of hardcoded recipient lists.
 */
async function dispatchStatusNotifications(input: DispatchInput): Promise<void> {
  const { newStatus, invoiceNumber, totalCents, contractorId, projectId, reason, actor, organizationId, payment } = input

  // Resolve WHO gets notified from configuration (role / user / project-role / vendor).
  const recipients = await resolveRecipients({
    event: newStatus as DistributionEvent,
    organizationId: organizationId ?? null,
    contractorId,
    projectId,
    actorUserId: actor.userId,
  })
  if (recipients.length === 0) return

  const amount = formatCents(totalCents)
  const enrichment = await buildPaymentEnrichment(newStatus, contractorId, projectId, payment)
  const { title, body } = buildMessage(newStatus, invoiceNumber, amount, reason, enrichment)
  const type = statusToInAppType(newStatus)
  const link = `/invoices/${input.invoiceId}`

  // Internal staff copied on this communication — recorded on each log row.
  const ccRecipients = recipients
    .filter((r) => r.role !== 'contractor')
    .map((r) => ({ name: r.name, email: r.email, role: r.role }))

  await Promise.all(
    recipients.map((r) =>
      sendNotificationToRecipient({
        recipientUserId: r.userId,
        recipient: {
          id: r.userId ?? r.contractorId ?? undefined,
          name: r.name,
          email: r.email ?? undefined,
          phone: r.phone ?? undefined,
          role: r.role as 'admin' | 'accountant' | 'project_manager' | 'contractor',
          emailEnabled: r.emailEnabled,
          smsEnabled: r.smsEnabled,
          whatsAppEnabled: r.whatsAppEnabled,
        },
        type,
        title,
        body,
        link,
        invoiceId: input.invoiceId,
        context: {
          invoiceId: input.invoiceId,
          contractorId: contractorId ?? undefined,
          projectId: projectId ?? undefined,
          triggeredBy: actor.userId ?? undefined,
          paymentId: payment?.paymentId,
          ccRecipients,
        },
      })
    )
  )
}
