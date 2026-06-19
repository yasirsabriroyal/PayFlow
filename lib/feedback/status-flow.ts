/**
 * Feedback Portal — Status Flow Engine
 *
 * Mirrors the pattern from lib/invoices/status-flow.ts. Validates transitions,
 * persists the status change, writes a status history row, writes an audit log
 * row, and dispatches in-app + email notifications to the submitter.
 *
 * Never throws — returns a typed result so callers can handle errors cleanly.
 */

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { resolveActiveOrgId } from '@/lib/tenancy'
import { sendGenericAlert } from '@/lib/notifications/server-dispatch'

// ============================================================
// Types
// ============================================================

export type FeedbackStatus =
  | 'submitted'
  | 'under_review'
  | 'planned'
  | 'in_progress'
  | 'resolved'
  | 'released'
  | 'declined'
  | 'archived'

export type FeedbackType =
  | 'bug_report'
  | 'feature_request'
  | 'suggestion'
  | 'general'

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  submitted:    'Submitted',
  under_review: 'Under Review',
  planned:      'Planned',
  in_progress:  'In Progress',
  resolved:     'Resolved',
  released:     'Released',
  declined:     'Declined',
  archived:     'Archived',
}

export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  bug_report:      'Bug Report',
  feature_request: 'Feature Request',
  suggestion:      'Suggestion',
  general:         'General Feedback',
}

// ============================================================
// Allowed transition map
// ============================================================

const ALLOWED_TRANSITIONS: Record<FeedbackStatus, FeedbackStatus[]> = {
  submitted:    ['under_review', 'declined', 'archived'],
  under_review: ['planned', 'declined', 'resolved', 'archived', 'submitted'],
  planned:      ['in_progress', 'declined', 'archived'],
  in_progress:  ['resolved', 'archived'],
  resolved:     ['released', 'archived'],
  released:     ['archived'],
  declined:     ['under_review', 'archived'],
  archived:     [],
}

export function isTransitionAllowed(from: FeedbackStatus, to: FeedbackStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

// ============================================================
// Input / Result types
// ============================================================

export interface ApplyFeedbackStatusChangeInput {
  ticketId:        string
  newStatus:       FeedbackStatus
  reason?:         string
  changedByUserId: string
  changedByName:   string
  changedByRole:   string
  organizationId?: string | null
}

export interface ApplyFeedbackStatusChangeResult {
  success: boolean
  error?:  string
}

// ============================================================
// Core function
// ============================================================

export async function applyFeedbackStatusChange(
  input: ApplyFeedbackStatusChangeInput
): Promise<ApplyFeedbackStatusChangeResult> {
  const supabase = getSupabaseAdmin()
  const orgId = await resolveActiveOrgId(input.organizationId)

  // 1. Load ticket
  const { data: ticket, error: fetchErr } = await supabase
    .from('feedback_tickets')
    .select('id, ticket_number, type, status, title, submitted_by_user_id, submitted_by_name, submitted_by_email, organization_id')
    .eq('id', input.ticketId)
    .eq('organization_id', orgId)
    .single()

  if (fetchErr || !ticket) {
    return { success: false, error: 'Feedback ticket not found.' }
  }

  const oldStatus = ticket.status as FeedbackStatus
  const newStatus = input.newStatus

  // 2. Validate transition
  if (!isTransitionAllowed(oldStatus, newStatus)) {
    return {
      success: false,
      error: `Cannot transition from "${FEEDBACK_STATUS_LABELS[oldStatus]}" to "${FEEDBACK_STATUS_LABELS[newStatus]}".`,
    }
  }

  // 3. Update ticket
  const { error: updateErr } = await supabase
    .from('feedback_tickets')
    .update({
      status: newStatus,
      ...(newStatus === 'resolved' || newStatus === 'released'
        ? { resolved_at: new Date().toISOString(), resolved_by: input.changedByUserId }
        : {}),
    })
    .eq('id', input.ticketId)

  if (updateErr) {
    console.error('[feedback/status-flow] update failed:', updateErr)
    return { success: false, error: 'Failed to update ticket status.' }
  }

  // 4. Write status history row
  await supabase.from('feedback_status_history').insert({
    ticket_id:          input.ticketId,
    old_status:         oldStatus,
    new_status:         newStatus,
    changed_by_user_id: input.changedByUserId,
    changed_by_name:    input.changedByName,
    changed_by_role:    input.changedByRole,
    reason:             input.reason ?? null,
  })

  // 5. Write audit log (entity_type = 'feedback_ticket', action = text)
  await supabase.from('audit_logs').insert({
    entity_type:  'feedback_ticket',
    entity_id:    input.ticketId,
    action:       'feedback_status_changed' as unknown,
    user_id:      input.changedByUserId,
    user_role:    input.changedByRole as unknown,
    description:  `Feedback ticket ${ticket.ticket_number} status changed from ${oldStatus} to ${newStatus}`,
    old_values:   { status: oldStatus },
    new_values:   { status: newStatus, reason: input.reason ?? null },
  })

  // 6. Notify submitter (in-app only if no email on file; sendGenericAlert handles both)
  if (ticket.submitted_by_user_id) {
    const { data: submitterUser } = await supabase
      .from('users')
      .select('first_name, last_name, email, email_notifications_enabled')
      .eq('id', ticket.submitted_by_user_id)
      .single()

    if (submitterUser) {
      await sendGenericAlert({
        recipientUserId: ticket.submitted_by_user_id,
        recipient: {
          id:           ticket.submitted_by_user_id,
          name:         `${submitterUser.first_name} ${submitterUser.last_name}`.trim(),
          email:        submitterUser.email ?? ticket.submitted_by_email ?? undefined,
          emailEnabled: submitterUser.email_notifications_enabled ?? true,
        },
        type:  'feedback_status_changed',
        title: `Feedback ${ticket.ticket_number} — Status updated`,
        body:  `Your ${FEEDBACK_TYPE_LABELS[ticket.type as FeedbackType] ?? ticket.type} has been moved to: ${FEEDBACK_STATUS_LABELS[newStatus]}.${input.reason ? `\n\nNote: ${input.reason}` : ''}`,
        link:  `/feedback/${ticket.id}`,
      })
    }
  }

  return { success: true }
}
