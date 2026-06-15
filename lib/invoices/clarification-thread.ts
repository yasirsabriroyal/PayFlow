'use server'

/**
 * Invoice clarification thread.
 *
 * A status-neutral, back-and-forth conversation attached to an invoice. The
 * participants are the invoice's contractor and internal staff (admin /
 * accountant / the assigned project manager). Posting a message NEVER changes
 * the invoice status — use the reject / dispute actions for that.
 *
 * All access is mediated here with the service-role client, so the underlying
 * tables keep RLS enabled with no public policies.
 */

import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getAssignedProjectIds } from '@/lib/permissions/pm-scope'

export type ThreadActorKind = 'staff' | 'contractor'

export interface ThreadActor {
  kind: ThreadActorKind
  /** internal users.id (staff only) */
  userId: string | null
  /** contractors.id (contractor only) */
  contractorId: string | null
  /** admin | accountant | project_manager | contractor */
  role: string
  name: string
  /** supabase auth user id */
  authId: string
}

export interface ThreadAttachment {
  id: string
  fileName: string
  fileType: string | null
  fileSizeBytes: number | null
  createdAt: string
}

export interface ThreadMessage {
  id: string
  body: string
  authorRole: string
  authorName: string
  authorKind: ThreadActorKind
  /** True when this message was written by the current viewer. */
  isMine: boolean
  createdAt: string
  attachments: ThreadAttachment[]
}

const STAFF_ROLES = ['admin', 'accountant', 'project_manager']

interface InvoiceRef {
  id: string
  project_id: string
  contractor_id: string
}

/**
 * Resolve the calling user's relationship to an invoice's thread.
 * Returns the actor + invoice when access is allowed, otherwise an error.
 */
async function resolveThreadActor(
  invoiceId: string
): Promise<{ ok: true; actor: ThreadActor; invoice: InvoiceRef } | { ok: false; error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Unauthorized' }

  const admin = getSupabaseAdmin()

  const { data: invoice } = await admin
    .from('invoices')
    .select('id, project_id, contractor_id')
    .eq('id', invoiceId)
    .maybeSingle()

  if (!invoice) return { ok: false, error: 'Invoice not found' }

  // Internal staff path.
  const { data: staff } = await admin
    .from('users')
    .select('id, role, first_name, last_name')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (staff && STAFF_ROLES.includes(staff.role as string)) {
    // Project managers are limited to their assigned projects.
    if (staff.role === 'project_manager') {
      const assigned = await getAssignedProjectIds(user.id)
      if (!assigned.includes(invoice.project_id as string)) {
        return { ok: false, error: 'Invoice not found' }
      }
    }
    const name =
      [staff.first_name, staff.last_name].filter(Boolean).join(' ').trim() || 'Staff'
    return {
      ok: true,
      invoice: invoice as InvoiceRef,
      actor: {
        kind: 'staff',
        userId: staff.id as string,
        contractorId: null,
        role: staff.role as string,
        name,
        authId: user.id,
      },
    }
  }

  // Contractor path — must own the invoice.
  const { data: contractor } = await admin
    .from('contractors')
    .select('id, company_name, contact_name')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (contractor && contractor.id === invoice.contractor_id) {
    const name =
      (contractor.contact_name as string) || (contractor.company_name as string) || 'Contractor'
    return {
      ok: true,
      invoice: invoice as InvoiceRef,
      actor: {
        kind: 'contractor',
        userId: null,
        contractorId: contractor.id as string,
        role: 'contractor',
        name,
        authId: user.id,
      },
    }
  }

  return { ok: false, error: 'You do not have access to this invoice' }
}

/**
 * Lightweight access check for routes that need to authorize a thread action
 * (e.g. attachment upload). Returns the actor + invoice when allowed.
 */
export async function checkThreadAccess(invoiceId: string): Promise<
  | { ok: true; actor: ThreadActor; invoice: InvoiceRef }
  | { ok: false; error: string }
> {
  return resolveThreadActor(invoiceId)
}

/** Fetch the full thread for an invoice (authorized). */
export async function getInvoiceThread(invoiceId: string): Promise<{
  success: boolean
  error?: string
  actor?: { kind: ThreadActorKind; role: string; name: string }
  messages?: ThreadMessage[]
}> {
  const access = await resolveThreadActor(invoiceId)
  if (!access.ok) return { success: false, error: access.error }
  const { actor } = access
  const admin = getSupabaseAdmin()

  const { data: rows, error } = await admin
    .from('invoice_messages')
    .select(
      'id, body, author_role, author_name, author_user_id, author_contractor_id, created_at'
    )
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Get invoice thread error:', error)
    return { success: false, error: 'Failed to load messages' }
  }

  const messageIds = (rows || []).map((r) => r.id as string)
  let attachmentsByMessage: Record<string, ThreadAttachment[]> = {}
  if (messageIds.length > 0) {
    const { data: atts } = await admin
      .from('invoice_message_attachments')
      .select('id, message_id, file_name, file_type, file_size_bytes, created_at')
      .in('message_id', messageIds)
      .order('created_at', { ascending: true })

    attachmentsByMessage = (atts || []).reduce((acc, a) => {
      const key = a.message_id as string
      ;(acc[key] ||= []).push({
        id: a.id as string,
        fileName: a.file_name as string,
        fileType: (a.file_type as string) ?? null,
        fileSizeBytes: (a.file_size_bytes as number) ?? null,
        createdAt: a.created_at as string,
      })
      return acc
    }, {} as Record<string, ThreadAttachment[]>)
  }

  const messages: ThreadMessage[] = (rows || []).map((r) => {
    const kind: ThreadActorKind = r.author_contractor_id ? 'contractor' : 'staff'
    const isMine =
      actor.kind === 'staff'
        ? r.author_user_id === actor.userId
        : r.author_contractor_id === actor.contractorId
    return {
      id: r.id as string,
      body: r.body as string,
      authorRole: r.author_role as string,
      authorName: r.author_name as string,
      authorKind: kind,
      isMine,
      createdAt: r.created_at as string,
      attachments: attachmentsByMessage[r.id as string] || [],
    }
  })

  return {
    success: true,
    actor: { kind: actor.kind, role: actor.role, name: actor.name },
    messages,
  }
}

/** Post a new message to the thread (authorized). Returns the new message id. */
export async function postInvoiceMessage(
  invoiceId: string,
  body: string
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  const trimmed = (body || '').trim()
  if (!trimmed) return { success: false, error: 'Message cannot be empty' }
  if (trimmed.length > 5000) return { success: false, error: 'Message is too long' }

  const access = await resolveThreadActor(invoiceId)
  if (!access.ok) return { success: false, error: access.error }
  const { actor } = access
  const admin = getSupabaseAdmin()

  const { data: inserted, error } = await admin
    .from('invoice_messages')
    .insert({
      invoice_id: invoiceId,
      body: trimmed,
      author_user_id: actor.userId,
      author_contractor_id: actor.contractorId,
      author_role: actor.role,
      author_name: actor.name,
    })
    .select('id')
    .single()

  if (error || !inserted) {
    console.error('Post invoice message error:', error)
    return { success: false, error: 'Failed to send message' }
  }

  // Best-effort audit trail (does not change invoice status).
  await admin.from('audit_logs').insert({
    action: 'invoice_message_posted',
    entity_type: 'invoice',
    entity_id: invoiceId,
    user_id: actor.userId,
    description: `${actor.name} posted a clarification message`,
  })

  return { success: true, messageId: inserted.id as string }
}

/**
 * Authorize a viewer's access to a single message attachment (used by the
 * file-serving route). Returns the blob pathname + metadata when allowed.
 */
export async function authorizeAttachmentAccess(attachmentId: string): Promise<{
  ok: boolean
  fileUrl?: string
  fileName?: string
  fileType?: string | null
}> {
  const admin = getSupabaseAdmin()
  const { data: att } = await admin
    .from('invoice_message_attachments')
    .select('id, invoice_id, file_url, file_name, file_type')
    .eq('id', attachmentId)
    .maybeSingle()

  if (!att) return { ok: false }

  const access = await resolveThreadActor(att.invoice_id as string)
  if (!access.ok) return { ok: false }

  return {
    ok: true,
    fileUrl: att.file_url as string,
    fileName: att.file_name as string,
    fileType: (att.file_type as string) ?? null,
  }
}
