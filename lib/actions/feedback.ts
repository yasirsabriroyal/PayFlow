'use server'

/**
 * Feedback Portal — Server Actions
 *
 * All mutations use the service-role admin client (bypasses RLS so the
 * trigger-generated ticket_number is visible immediately). All queries
 * scope by organization_id via resolveActiveOrgId().
 */

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import {
  type FeedbackStatus,
  type FeedbackType,
  type FeedbackPriority,
  FEEDBACK_TYPE_LABELS,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_PRIORITY_LABELS,
  isTransitionAllowed,
} from '@/lib/feedback/constants'

// Inline org resolver — avoids importing lib/tenancy which has 'import server-only'
// at the top level, causing module evaluation to fail in RSC rendering contexts.
async function getOrgId(): Promise<string> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('organizations')
    .select('id')
    .eq('is_default', true)
    .limit(1)
    .single()
  return data?.id ?? 'default'
}

// FeedbackPriority and FEEDBACK_PRIORITY_LABELS live in @/lib/feedback/constants

export interface FeedbackTicket {
  id:                         string
  ticket_number:              string
  type:                       FeedbackType
  status:                     FeedbackStatus
  priority:                   FeedbackPriority | null
  title:                      string
  description:                string
  module_page:                string | null
  steps_to_reproduce:         string | null
  expected_result:            string | null
  actual_result:              string | null
  business_reason:            string | null
  desired_outcome:            string | null
  assigned_to:                string | null
  assigned_to_name?:          string | null
  resolved_at:                string | null
  submitted_by_user_id:       string | null
  submitted_by_contractor_id: string | null
  submitted_by_name:          string
  submitted_by_email:         string | null
  created_at:                 string
  updated_at:                 string
  vote_count:                 number
  user_has_voted?:            boolean
}

export interface FeedbackStatusHistory {
  id:                 string
  ticket_id:          string
  old_status:         string | null
  new_status:         string
  changed_by_name:    string
  changed_by_role:    string
  reason:             string | null
  created_at:         string
}

export interface FeedbackComment {
  id:           string
  ticket_id:    string
  body:         string
  is_internal:  boolean
  author_name:  string
  author_role:  string
  author_user_id: string | null
  created_at:   string
}

export interface FeedbackAttachment {
  id:           string
  ticket_id:    string
  file_url:     string
  file_name:    string
  file_type:    string | null
  file_size_bytes: number | null
  created_at:   string
}

export interface FeedbackTicketDetail extends FeedbackTicket {
  status_history: FeedbackStatusHistory[]
  comments:       FeedbackComment[]      // public only (is_internal = false)
  internal_notes: FeedbackComment[]      // is_internal = true
  attachments:    FeedbackAttachment[]
}

export interface CreateFeedbackInput {
  type:               FeedbackType
  title:              string
  description:        string
  module_page?:       string
  steps_to_reproduce?: string
  expected_result?:   string
  actual_result?:     string
  business_reason?:   string
  desired_outcome?:   string
}

export interface FeedbackListFilters {
  type?:         FeedbackType | 'all'
  status?:       FeedbackStatus | 'all'
  priority?:     FeedbackPriority | 'all'
  assignedTo?:   string
  modulePage?:   string
  search?:       string
  submittedBy?:  string  // admin filter
  page?:         number
  perPage?:      number
  sortBy?:       'created_at' | 'vote_count' | 'updated_at'
  sortDir?:      'asc' | 'desc'
}

export interface FeedbackListResult {
  tickets:    FeedbackTicket[]
  total:      number
  page:       number
  perPage:    number
  totalPages: number
}

// ============================================================
// 1. Create Feedback Ticket
// ============================================================

export async function createFeedbackTicket(
  input: CreateFeedbackInput
): Promise<{ success: boolean; ticketId?: string; ticketNumber?: string; error?: string }> {
  const supabase = getSupabaseAdmin()
  const { createClient } = await import('@/lib/supabase/server')
  const authClient = await createClient()
  const orgId = await getOrgId()

  const { data: { user: authUser } } = await authClient.auth.getUser()
  if (!authUser) return { success: false, error: 'Not authenticated.' }

  // Resolve submitter display name and email
  const { data: profile } = await supabase
    .from('users')
    .select('id, first_name, last_name, email')
    .eq('auth_user_id', authUser.id)
    .single()

  const submitterName  = profile ? `${profile.first_name} ${profile.last_name}`.trim() : authUser.email ?? 'Unknown'
  const submitterEmail = profile?.email ?? authUser.email ?? null
  const submitterUserId = profile?.id ?? null

  // Insert ticket (ticket_number generated by DB trigger)
  const { data: ticket, error: insertErr } = await supabase
    .from('feedback_tickets')
    .insert({
      organization_id:       orgId,
      type:                  input.type,
      title:                 input.title,
      description:           input.description,
      module_page:           input.module_page           ?? null,
      steps_to_reproduce:    input.steps_to_reproduce    ?? null,
      expected_result:       input.expected_result       ?? null,
      actual_result:         input.actual_result         ?? null,
      business_reason:       input.business_reason       ?? null,
      desired_outcome:       input.desired_outcome       ?? null,
      submitted_by_user_id:  submitterUserId,
      submitted_by_name:     submitterName,
      submitted_by_email:    submitterEmail,
    })
    .select('id, ticket_number')
    .single()

  if (insertErr || !ticket) {
    console.error('[feedback/actions] createFeedbackTicket insert failed:', insertErr)
    return { success: false, error: 'Failed to create feedback ticket.' }
  }

  // Notify all admins
  const { data: admins } = await supabase
    .from('users')
    .select('id, first_name, last_name, email, email_notifications_enabled')
    .eq('role', 'admin')
    .eq('is_active', true)

  if (admins && admins.length > 0) {
    const typeLabel = FEEDBACK_TYPE_LABELS[input.type] ?? input.type
    const { sendGenericAlert } = await import('@/lib/notifications/server-dispatch')
    for (const admin of admins) {
      await sendGenericAlert({
        recipientUserId: admin.id,
        recipient: {
          id:           admin.id,
          name:         `${admin.first_name} ${admin.last_name}`.trim(),
          email:        admin.email ?? undefined,
          emailEnabled: admin.email_notifications_enabled ?? true,
        },
        type:  'feedback_submitted',
        title: `New feedback: ${input.title}`,
        body:  `${typeLabel} — Ticket ${ticket.ticket_number} submitted by ${submitterName}.`,
        link:  `/admin/feedback/${ticket.id}`,
      })
    }
  }

  return { success: true, ticketId: ticket.id, ticketNumber: ticket.ticket_number }
}

// ============================================================
// 2. Get Feedback Tickets (with filters + pagination)
// ============================================================

export async function getFeedbackTickets(
  filters: FeedbackListFilters = {},
  viewAll = false
): Promise<FeedbackListResult> {
  const supabase = getSupabaseAdmin()
  const { createClient } = await import('@/lib/supabase/server')
  const authClient = await createClient()
  const orgId = await getOrgId()

  const { data: { user: authUser } } = await authClient.auth.getUser()
  if (!authUser) return { tickets: [], total: 0, page: 1, perPage: 20, totalPages: 0 }

  const page    = filters.page    ?? 1
  const perPage = filters.perPage ?? 20
  const from    = (page - 1) * perPage
  const to      = from + perPage - 1

  // Resolve current user profile for role check + vote lookup
  let currentUserProfileId: string | null = null
  let currentUserRole: string | null = null
  {
    const { data: profile } = await supabase
      .from('users')
      .select('id, role')
      .eq('auth_user_id', authUser.id)
      .single()
    currentUserProfileId = profile?.id ?? null
    currentUserRole      = profile?.role ?? null
  }

  // Security: only admins may use viewAll=true
  const effectiveViewAll = viewAll && currentUserRole === 'admin'

  let query = supabase
    .from('feedback_tickets')
    .select('*, assigned_user:assigned_to(first_name, last_name), feedback_votes(id, user_id)', { count: 'exact' })
    .eq('organization_id', orgId)

  // Scope to submitter when not admin view
  if (!effectiveViewAll) {
    if (currentUserProfileId) {
      query = query.eq('submitted_by_user_id', currentUserProfileId)
    }
  }

  // Apply filters
  if (filters.type && filters.type !== 'all')         query = query.eq('type', filters.type)
  if (filters.status && filters.status !== 'all')     query = query.eq('status', filters.status)
  if (filters.priority && filters.priority !== 'all') query = query.eq('priority', filters.priority)
  if (filters.assignedTo)                             query = query.eq('assigned_to', filters.assignedTo)
  if (filters.modulePage)                             query = query.eq('module_page', filters.modulePage)
  if (filters.submittedBy)                            query = query.eq('submitted_by_user_id', filters.submittedBy)
  if (filters.search) {
    query = query.or(`title.ilike.%${filters.search}%,ticket_number.ilike.%${filters.search}%`)
  }

  const sortBy  = filters.sortBy  ?? 'created_at'
  const sortDir = filters.sortDir ?? 'desc'

  const { data, count, error } = await query
    .order(sortBy === 'vote_count' ? 'created_at' : sortBy, { ascending: sortDir === 'asc' })
    .range(from, to)

  if (error) {
    console.error('[feedback/actions] getFeedbackTickets failed:', error)
    return { tickets: [], total: 0, page, perPage, totalPages: 0 }
  }

  const total = count ?? 0
  const tickets: FeedbackTicket[] = (data ?? []).map((row: Record<string, unknown>) => {
    const votes       = (row.feedback_votes as Array<{ id: string; user_id: string }>) ?? []
    const voteCount   = votes.length
    const userVoted   = currentUserProfileId ? votes.some(v => v.user_id === currentUserProfileId) : false
    return {
      id:                         row.id as string,
      ticket_number:              row.ticket_number as string,
      type:                       row.type as FeedbackType,
      status:                     row.status as FeedbackStatus,
      priority:                   (row.priority as FeedbackPriority | null) ?? null,
      title:                      row.title as string,
      description:                row.description as string,
      module_page:                row.module_page as string | null,
      steps_to_reproduce:         row.steps_to_reproduce as string | null,
      expected_result:            row.expected_result as string | null,
      actual_result:              row.actual_result as string | null,
      business_reason:            row.business_reason as string | null,
      desired_outcome:            row.desired_outcome as string | null,
      assigned_to:                row.assigned_to as string | null,
      assigned_to_name:           row.assigned_user
        ? `${(row.assigned_user as Record<string, string>).first_name ?? ''} ${(row.assigned_user as Record<string, string>).last_name ?? ''}`.trim()
        : null,
      resolved_at:                row.resolved_at as string | null,
      submitted_by_user_id:       row.submitted_by_user_id as string | null,
      submitted_by_contractor_id: row.submitted_by_contractor_id as string | null,
      submitted_by_name:          row.submitted_by_name as string,
      submitted_by_email:         row.submitted_by_email as string | null,
      created_at:                 row.created_at as string,
      updated_at:                 row.updated_at as string,
      vote_count:                 voteCount,
      user_has_voted:             userVoted,
    }
  })

  return { tickets, total, page, perPage, totalPages: Math.ceil(total / perPage) }
}

// ============================================================
// 3. Get Single Feedback Ticket (full detail)
// ============================================================

export async function getFeedbackTicket(
  ticketId: string,
  isAdmin = false
): Promise<FeedbackTicketDetail | null> {
  const supabase = getSupabaseAdmin()
  const { createClient } = await import('@/lib/supabase/server')
  const authClient = await createClient()
  const orgId = await getOrgId()

  const { data: { user: authUser } } = await authClient.auth.getUser()
  if (!authUser) return null

  const { data: ticket, error } = await supabase
    .from('feedback_tickets')
    .select('*')
    .eq('id', ticketId)
    .eq('organization_id', orgId)
    .single()

  if (error || !ticket) return null

  // Scope check for non-admin callers
  if (!isAdmin) {
    const { data: profile } = await supabase
      .from('users')
      .select('id')
      .eq('auth_user_id', authUser.id)
      .single()
    if (!profile || ticket.submitted_by_user_id !== profile.id) return null
  }

  // Status history
  const { data: history } = await supabase
    .from('feedback_status_history')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })

  // Comments — admins see all; users see only public
  let commentsQuery = supabase
    .from('feedback_comments')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })

  if (!isAdmin) {
    commentsQuery = commentsQuery.eq('is_internal', false)
  }

  const { data: allComments } = await commentsQuery

  // Attachments
  const { data: attachments } = await supabase
    .from('feedback_attachments')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: false })

  const publicComments   = (allComments ?? []).filter((c: Record<string, unknown>) => !c.is_internal)
  const internalComments = (allComments ?? []).filter((c: Record<string, unknown>) => c.is_internal)

  const mapComment = (c: Record<string, unknown>): FeedbackComment => ({
    id:             c.id as string,
    ticket_id:      c.ticket_id as string,
    body:           c.body as string,
    is_internal:    c.is_internal as boolean,
    author_name:    c.author_name as string,
    author_role:    c.author_role as string,
    author_user_id: c.author_user_id as string | null,
    created_at:     c.created_at as string,
  })

  // Fetch vote count + whether current user voted
  const { count: voteCount } = await supabase
    .from('feedback_votes')
    .select('*', { count: 'exact', head: true })
    .eq('ticket_id', ticketId)

  let userHasVoted = false
  if (authUser) {
    const { data: profile2 } = await supabase
      .from('users')
      .select('id')
      .eq('auth_user_id', authUser.id)
      .single()
    if (profile2) {
      const { data: myVote } = await supabase
        .from('feedback_votes')
        .select('id')
        .eq('ticket_id', ticketId)
        .eq('user_id', profile2.id)
        .single()
      userHasVoted = !!myVote
    }
  }

  return {
    id:                         ticket.id,
    ticket_number:              ticket.ticket_number,
    type:                       ticket.type as FeedbackType,
    status:                     ticket.status as FeedbackStatus,
    priority:                   (ticket.priority as FeedbackPriority | null) ?? null,
    title:                      ticket.title,
    description:                ticket.description,
    module_page:                ticket.module_page,
    steps_to_reproduce:         ticket.steps_to_reproduce,
    expected_result:            ticket.expected_result,
    actual_result:              ticket.actual_result,
    business_reason:            ticket.business_reason,
    desired_outcome:            ticket.desired_outcome,
    assigned_to:                ticket.assigned_to,
    resolved_at:                ticket.resolved_at,
    submitted_by_user_id:       ticket.submitted_by_user_id,
    submitted_by_contractor_id: ticket.submitted_by_contractor_id,
    submitted_by_name:          ticket.submitted_by_name,
    submitted_by_email:         ticket.submitted_by_email,
    created_at:                 ticket.created_at,
    updated_at:                 ticket.updated_at,
    vote_count:                 voteCount ?? 0,
    user_has_voted:             userHasVoted,
    status_history:             (history ?? []).map((h: Record<string, unknown>) => ({
      id:              h.id as string,
      ticket_id:       h.ticket_id as string,
      old_status:      h.old_status as string | null,
      new_status:      h.new_status as string,
      changed_by_name: h.changed_by_name as string,
      changed_by_role: h.changed_by_role as string,
      reason:          h.reason as string | null,
      created_at:      h.created_at as string,
    })),
    comments:       publicComments.map(mapComment),
    internal_notes: internalComments.map(mapComment),
    attachments:    (attachments ?? []).map((a: Record<string, unknown>) => ({
      id:              a.id as string,
      ticket_id:       a.ticket_id as string,
      file_url:        a.file_url as string,
      file_name:       a.file_name as string,
      file_type:       a.file_type as string | null,
      file_size_bytes: a.file_size_bytes as number | null,
      created_at:      a.created_at as string,
    })),
  }
}

// ============================================================
// 4. Update Feedback Status (admin)
// ============================================================

export async function updateFeedbackStatus(
  ticketId:  string,
  newStatus: FeedbackStatus,
  reason?:   string
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseAdmin()
  const { createClient } = await import('@/lib/supabase/server')
  const authClient = await createClient()

  const { data: { user: authUser } } = await authClient.auth.getUser()
  if (!authUser) return { success: false, error: 'Not authenticated.' }

  const { data: profile } = await supabase
    .from('users')
    .select('id, first_name, last_name, role')
    .eq('auth_user_id', authUser.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return { success: false, error: 'Admin role required.' }
  }

  // Inline status-change logic — status-flow.ts cannot be statically imported here
  // because it transitively imports server-dispatch.ts which has 'import server-only',
  // causing module evaluation to abort before any exports are registered.
  const changedByUserId = profile.id
  const changedByName   = `${profile.first_name} ${profile.last_name}`.trim()
  const changedByRole   = profile.role
  const orgId           = await getOrgId()

  const { data: ticket, error: fetchErr } = await supabase
    .from('feedback_tickets')
    .select('id, ticket_number, type, status, title, submitted_by_user_id, submitted_by_name, submitted_by_email')
    .eq('id', ticketId)
    .eq('organization_id', orgId)
    .single()

  if (fetchErr || !ticket) return { success: false, error: 'Feedback ticket not found.' }

  const oldStatus = ticket.status as FeedbackStatus

  if (!isTransitionAllowed(oldStatus, newStatus)) {
    return {
      success: false,
      error: `Cannot transition from "${FEEDBACK_STATUS_LABELS[oldStatus]}" to "${FEEDBACK_STATUS_LABELS[newStatus]}".`,
    }
  }

  const { error: updateErr } = await supabase
    .from('feedback_tickets')
    .update({
      status: newStatus,
      ...(newStatus === 'resolved' || newStatus === 'released'
        ? { resolved_at: new Date().toISOString(), resolved_by: changedByUserId }
        : {}),
    })
    .eq('id', ticketId)

  if (updateErr) return { success: false, error: 'Failed to update ticket status.' }

  await supabase.from('feedback_status_history').insert({
    ticket_id:          ticketId,
    old_status:         oldStatus,
    new_status:         newStatus,
    changed_by_user_id: changedByUserId,
    changed_by_name:    changedByName,
    changed_by_role:    changedByRole,
    reason:             reason ?? null,
  })

  await supabase.from('audit_logs').insert({
    entity_type:  'feedback_ticket',
    entity_id:    ticketId,
    action:       'feedback_status_changed' as unknown,
    user_id:      changedByUserId,
    user_role:    changedByRole as unknown,
    description:  `Feedback ${ticket.ticket_number} status changed from ${oldStatus} to ${newStatus}`,
    old_values:   { status: oldStatus },
    new_values:   { status: newStatus, reason: reason ?? null },
  })

  if (ticket.submitted_by_user_id) {
    const { data: submitter } = await supabase
      .from('users')
      .select('first_name, last_name, email, email_notifications_enabled')
      .eq('id', ticket.submitted_by_user_id)
      .single()

    if (submitter) {
      // Dynamic import so the server-only chain never enters the static import graph
      const { sendGenericAlert } = await import('@/lib/notifications/server-dispatch')
      await sendGenericAlert({
        recipientUserId: ticket.submitted_by_user_id,
        recipient: {
          id:           ticket.submitted_by_user_id,
          name:         `${submitter.first_name} ${submitter.last_name}`.trim(),
          email:        submitter.email ?? ticket.submitted_by_email ?? undefined,
          emailEnabled: submitter.email_notifications_enabled ?? true,
        },
        type:  'feedback_status_changed',
        title: `Feedback ${ticket.ticket_number} — Status updated`,
        body:  `Your ${FEEDBACK_TYPE_LABELS[ticket.type as FeedbackType] ?? ticket.type} has been moved to: ${FEEDBACK_STATUS_LABELS[newStatus]}.${reason ? `\n\nNote: ${reason}` : ''}`,
        link:  `/feedback/${ticket.id}`,
      })
    }
  }

  return { success: true }
}

// ============================================================
// 5. Assign Feedback Ticket (admin)
// ============================================================

export async function assignFeedbackTicket(
  ticketId: string,
  assignedToUserId: string | null
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseAdmin()
  const { createClient } = await import('@/lib/supabase/server')
  const authClient = await createClient()
  const orgId = await getOrgId()

  const { data: { user: authUser } } = await authClient.auth.getUser()
  if (!authUser) return { success: false, error: 'Not authenticated.' }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('auth_user_id', authUser.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return { success: false, error: 'Admin role required.' }
  }

  const { error } = await supabase
    .from('feedback_tickets')
    .update({ assigned_to: assignedToUserId })
    .eq('id', ticketId)
    .eq('organization_id', orgId)

  if (error) return { success: false, error: 'Failed to assign ticket.' }
  return { success: true }
}

// ============================================================
// 6. Add Comment / Internal Note
// ============================================================

export async function addFeedbackComment(
  ticketId:   string,
  body:       string,
  isInternal: boolean = false
): Promise<{ success: boolean; commentId?: string; error?: string }> {
  const supabase = getSupabaseAdmin()
  const { createClient } = await import('@/lib/supabase/server')
  const authClient = await createClient()
  const orgId = await getOrgId()

  const { data: { user: authUser } } = await authClient.auth.getUser()
  if (!authUser) return { success: false, error: 'Not authenticated.' }

  const { data: profile } = await supabase
    .from('users')
    .select('id, first_name, last_name, role, email, email_notifications_enabled')
    .eq('auth_user_id', authUser.id)
    .single()

  if (!profile) return { success: false, error: 'User not found.' }

  const trimmedBody = body.trim()
  if (!trimmedBody || trimmedBody.length > 5000) {
    return { success: false, error: 'Comment must be between 1 and 5000 characters.' }
  }

  // Internal notes: admin only
  if (isInternal && profile.role !== 'admin') {
    return { success: false, error: 'Admin role required for internal notes.' }
  }

  const { data: comment, error: insertErr } = await supabase
    .from('feedback_comments')
    .insert({
      ticket_id:       ticketId,
      organization_id: orgId,
      body:            trimmedBody,
      is_internal:     isInternal,
      author_user_id:  profile.id,
      author_name:     `${profile.first_name} ${profile.last_name}`.trim(),
      author_role:     profile.role,
    })
    .select('id')
    .single()

  if (insertErr || !comment) {
    return { success: false, error: 'Failed to add comment.' }
  }

  // Fetch ticket for notification routing
  const { data: ticket } = await supabase
    .from('feedback_tickets')
    .select('id, ticket_number, type, title, submitted_by_user_id, submitted_by_email, assigned_to')
    .eq('id', ticketId)
    .single()

  const { sendGenericAlert } = await import('@/lib/notifications/server-dispatch')

  // Admin → public comment: notify submitter
  if (!isInternal && profile.role === 'admin' && ticket?.submitted_by_user_id) {
    const { data: submitter } = await supabase
      .from('users')
      .select('first_name, last_name, email, email_notifications_enabled')
      .eq('id', ticket.submitted_by_user_id)
      .single()

    if (submitter) {
      await sendGenericAlert({
        recipientUserId: ticket.submitted_by_user_id,
        recipient: {
          id:           ticket.submitted_by_user_id,
          name:         `${submitter.first_name} ${submitter.last_name}`.trim(),
          email:        submitter.email ?? ticket.submitted_by_email ?? undefined,
          emailEnabled: submitter.email_notifications_enabled ?? true,
        },
        type:  'feedback_commented',
        title: `New comment on ${ticket.ticket_number}`,
        body:  `A team member has added a comment to your ${FEEDBACK_TYPE_LABELS[ticket.type as FeedbackType] ?? ticket.type}: "${ticket.title}"`,
        link:  `/feedback/${ticket.id}`,
      })
    }
  }

  // Submitter → public comment: notify assigned admin (Phase 2)
  if (!isInternal && profile.role !== 'admin' && ticket?.assigned_to) {
    const { data: assignee } = await supabase
      .from('users')
      .select('id, first_name, last_name, email, email_notifications_enabled')
      .eq('id', ticket.assigned_to)
      .single()

    if (assignee) {
      await sendGenericAlert({
        recipientUserId: assignee.id,
        recipient: {
          id:           assignee.id,
          name:         `${assignee.first_name} ${assignee.last_name}`.trim(),
          email:        assignee.email ?? undefined,
          emailEnabled: assignee.email_notifications_enabled ?? true,
        },
        type:  'feedback_reply',
        title: `Reply on ${ticket.ticket_number}`,
        body:  `${profile.first_name} ${profile.last_name} replied on: "${ticket.title}"`,
        link:  `/admin/feedback/${ticket.id}`,
      })
    }
  }

  return { success: true, commentId: comment.id }
}

// ============================================================
// 7. Upload Attachment
// ============================================================

export async function uploadFeedbackAttachment(
  ticketId:       string,
  fileUrl:        string,
  fileName:       string,
  fileType?:      string,
  fileSizeBytes?: number
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseAdmin()
  const { createClient } = await import('@/lib/supabase/server')
  const authClient = await createClient()
  const orgId = await getOrgId()

  const { data: { user: authUser } } = await authClient.auth.getUser()
  if (!authUser) return { success: false, error: 'Not authenticated.' }

  const { data: profile } = await supabase
    .from('users')
    .select('id')
    .eq('auth_user_id', authUser.id)
    .single()

  const { error } = await supabase.from('feedback_attachments').insert({
    ticket_id:            ticketId,
    organization_id:      orgId,
    file_url:             fileUrl,
    file_name:            fileName,
    file_type:            fileType ?? null,
    file_size_bytes:      fileSizeBytes ?? null,
    uploaded_by_user_id:  profile?.id ?? null,
  })

  if (error) return { success: false, error: 'Failed to save attachment.' }
  return { success: true }
}

// ============================================================
// 8. Get admin users (for assignee dropdown)
// ============================================================

export async function getAdminUsersForAssignment(): Promise<
  Array<{ id: string; name: string; role: string }>
> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('users')
    .select('id, first_name, last_name, role')
    .in('role', ['admin', 'project_manager', 'accountant'])
    .eq('is_active', true)
    .order('first_name', { ascending: true })

  return (data ?? []).map((u: Record<string, unknown>) => ({
    id:   u.id as string,
    name: `${u.first_name} ${u.last_name}`.trim(),
    role: u.role as string,
  }))
}

// ============================================================
// 9. Get feedback stats for current user
// ============================================================

export async function getFeedbackStats(): Promise<{
  total: number
  open:  number
  resolved: number
}> {
  const supabase = getSupabaseAdmin()
  const { createClient } = await import('@/lib/supabase/server')
  const authClient = await createClient()
  const orgId = await getOrgId()

  const { data: { user: authUser } } = await authClient.auth.getUser()
  if (!authUser) return { total: 0, open: 0, resolved: 0 }

  const { data: profile } = await supabase
    .from('users')
    .select('id')
    .eq('auth_user_id', authUser.id)
    .single()

  if (!profile) return { total: 0, open: 0, resolved: 0 }

  const { data } = await supabase
    .from('feedback_tickets')
    .select('status')
    .eq('organization_id', orgId)
    .eq('submitted_by_user_id', profile.id)

  const all   = data ?? []
  const total   = all.length
  const resolved = all.filter((t: Record<string, unknown>) =>
    t.status === 'resolved' || t.status === 'released'
  ).length
  const open = all.filter((t: Record<string, unknown>) =>
    t.status !== 'resolved' && t.status !== 'released' && t.status !== 'archived' && t.status !== 'declined'
  ).length

  return { total, open, resolved }
}

// ============================================================
// 10. Toggle Vote on a feedback ticket
// ============================================================

export async function toggleFeedbackVote(
  ticketId: string
): Promise<{ success: boolean; voted: boolean; voteCount: number; error?: string }> {
  const supabase = getSupabaseAdmin()
  const { createClient } = await import('@/lib/supabase/server')
  const authClient = await createClient()

  const { data: { user: authUser } } = await authClient.auth.getUser()
  if (!authUser) return { success: false, voted: false, voteCount: 0, error: 'Not authenticated.' }

  const { data: profile } = await supabase
    .from('users')
    .select('id')
    .eq('auth_user_id', authUser.id)
    .single()

  if (!profile) return { success: false, voted: false, voteCount: 0, error: 'User not found.' }

  // Check existing vote
  const { data: existing } = await supabase
    .from('feedback_votes')
    .select('id')
    .eq('ticket_id', ticketId)
    .eq('user_id', profile.id)
    .single()

  if (existing) {
    // Remove vote
    await supabase.from('feedback_votes').delete().eq('id', existing.id)
  } else {
    // Add vote
    await supabase.from('feedback_votes').insert({ ticket_id: ticketId, user_id: profile.id })
  }

  // Return updated count
  const { count } = await supabase
    .from('feedback_votes')
    .select('*', { count: 'exact', head: true })
    .eq('ticket_id', ticketId)

  return { success: true, voted: !existing, voteCount: count ?? 0 }
}

// ============================================================
// 11. Set Priority (admin)
// ============================================================

export async function setFeedbackPriority(
  ticketId: string,
  priority: FeedbackPriority | null
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseAdmin()
  const { createClient } = await import('@/lib/supabase/server')
  const authClient = await createClient()
  const orgId = await getOrgId()

  const { data: { user: authUser } } = await authClient.auth.getUser()
  if (!authUser) return { success: false, error: 'Not authenticated.' }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('auth_user_id', authUser.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return { success: false, error: 'Admin role required.' }
  }

  const { error } = await supabase
    .from('feedback_tickets')
    .update({ priority })
    .eq('id', ticketId)
    .eq('organization_id', orgId)

  if (error) return { success: false, error: 'Failed to update priority.' }
  return { success: true }
}

// ============================================================
// 12. Bulk operations (admin)
// ============================================================

export type BulkFeedbackAction =
  | { type: 'set_status';   status:   FeedbackStatus }
  | { type: 'set_priority'; priority: FeedbackPriority | null }
  | { type: 'assign';       userId:   string | null }
  | { type: 'archive' }

export async function bulkFeedbackAction(
  ticketIds: string[],
  action: BulkFeedbackAction
): Promise<{ success: boolean; affected: number; error?: string }> {
  if (!ticketIds.length) return { success: true, affected: 0 }

  const supabase = getSupabaseAdmin()
  const { createClient } = await import('@/lib/supabase/server')
  const authClient = await createClient()
  const orgId = await getOrgId()

  const { data: { user: authUser } } = await authClient.auth.getUser()
  if (!authUser) return { success: false, affected: 0, error: 'Not authenticated.' }

  const { data: profile } = await supabase
    .from('users')
    .select('id, first_name, last_name, role')
    .eq('auth_user_id', authUser.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return { success: false, affected: 0, error: 'Admin role required.' }
  }

  let patch: Record<string, unknown> = {}

  if (action.type === 'set_status') {
    patch = { status: action.status }
  } else if (action.type === 'set_priority') {
    patch = { priority: action.priority }
  } else if (action.type === 'assign') {
    patch = { assigned_to: action.userId }
  } else if (action.type === 'archive') {
    patch = { status: 'archived' as FeedbackStatus }
  }

  const { error, data: updated } = await supabase
    .from('feedback_tickets')
    .update(patch)
    .in('id', ticketIds)
    .eq('organization_id', orgId)
    .select('id')

  if (error) return { success: false, affected: 0, error: 'Bulk operation failed.' }
  const count = updated?.length ?? ticketIds.length

  // Write status history rows for status changes
  if (action.type === 'set_status' || action.type === 'archive') {
    const newStatus = action.type === 'archive' ? 'archived' : (action as { type: 'set_status'; status: FeedbackStatus }).status
    const { data: tickets } = await supabase
      .from('feedback_tickets')
      .select('id, status')
      .in('id', ticketIds)
      .eq('organization_id', orgId)

    if (tickets) {
      await supabase.from('feedback_status_history').insert(
        tickets.map((t: Record<string, unknown>) => ({
          ticket_id:          t.id,
          old_status:         t.status,
          new_status:         newStatus,
          changed_by_user_id: profile.id,
          changed_by_name:    `${profile.first_name} ${profile.last_name}`.trim(),
          changed_by_role:    profile.role,
          reason:             'Bulk operation',
        }))
      )
    }
  }

  return { success: true, affected: count ?? ticketIds.length }
}

// ============================================================
// 13. Get unread feedback count for admin nav badge
// ============================================================

export async function getUnreadFeedbackCount(): Promise<number> {
  const supabase = getSupabaseAdmin()
  const { createClient } = await import('@/lib/supabase/server')
  const authClient = await createClient()
  const orgId = await getOrgId()

  const { data: { user: authUser } } = await authClient.auth.getUser()
  if (!authUser) return 0

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('auth_user_id', authUser.id)
    .single()

  if (!profile || profile.role !== 'admin') return 0

  const { count } = await supabase
    .from('feedback_tickets')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('status', 'submitted')

  return count ?? 0
}

// Types and labels must be imported directly from '@/lib/feedback/constants'.
// Do NOT add any export type {} re-exports here — Next.js 'use server' files
// cannot export type aliases without the Turbopack actions compiler treating
// them as callable server functions, causing runtime ReferenceErrors.
