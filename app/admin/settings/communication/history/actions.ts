'use server'

import { withPermission } from '@/lib/permissions/core'
import { PERMISSIONS } from '@/lib/permissions/constants'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { resolveActiveOrgId } from '@/lib/tenancy'

export interface CommunicationLogRow {
  id: string
  createdAt: string | null
  channel: string
  status: string
  eventType: string
  recipientName: string
  recipientEmail: string | null
  recipientRole: string | null
  subject: string | null
  messagePreview: string | null
  emailBody: string | null
  errorMessage: string | null
  sentAt: string | null
  deliveredAt: string | null
  failedAt: string | null
  templateKey: string | null
  templateVersion: number | null
  externalMessageId: string | null
  ccRecipients: { name?: string; email?: string | null; role?: string }[] | null
}

export interface CommunicationLogFilters {
  channel?: string
  status?: string
  search?: string
  page?: number
  pageSize?: number
}

export interface CommunicationLogPage {
  rows: CommunicationLogRow[]
  total: number
  page: number
  pageSize: number
}

const PAGE_SIZE = 25

/**
 * Fetch a paginated, filterable slice of the organization's communication logs.
 * Scoped to the active org through the tenancy seam, admin-gated, and read-only.
 */
export async function getCommunicationHistory(filters: CommunicationLogFilters = {}) {
  return withPermission(PERMISSIONS.ADMINISTRATION.VIEW_SYSTEM_LOGS, async () => {
    const supabase = getSupabaseAdmin()
    const orgId = await resolveActiveOrgId(null)

    const page = Math.max(1, filters.page ?? 1)
    const pageSize = Math.min(100, filters.pageSize ?? PAGE_SIZE)
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    let query = supabase
      .from('notification_logs')
      .select(
        'id, created_at, channel, status, event_type, recipient_name, recipient_email, recipient_role, subject, message_preview, email_body, error_message, sent_at, delivered_at, failed_at, template_key, template_version, external_message_id, cc_recipients',
        { count: 'exact' }
      )
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })

    if (filters.channel && filters.channel !== 'all') query = query.eq('channel', filters.channel)
    if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status)
    if (filters.search && filters.search.trim()) {
      const s = filters.search.trim().replace(/[%,]/g, '')
      query = query.or(
        `recipient_name.ilike.%${s}%,recipient_email.ilike.%${s}%,subject.ilike.%${s}%`
      )
    }

    const { data, error, count } = await query.range(from, to)
    if (error) {
      return { success: false as const, error: error.message }
    }

    const rows: CommunicationLogRow[] = (data ?? []).map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      channel: r.channel,
      status: r.status,
      eventType: r.event_type,
      recipientName: r.recipient_name,
      recipientEmail: r.recipient_email,
      recipientRole: r.recipient_role,
      subject: r.subject,
      messagePreview: r.message_preview,
      emailBody: r.email_body,
      errorMessage: r.error_message,
      sentAt: r.sent_at,
      deliveredAt: r.delivered_at,
      failedAt: r.failed_at,
      templateKey: r.template_key,
      templateVersion: r.template_version,
      externalMessageId: r.external_message_id,
      ccRecipients: (r.cc_recipients as CommunicationLogRow['ccRecipients']) ?? null,
    }))

    return {
      success: true as const,
      data: { rows, total: count ?? 0, page, pageSize } as CommunicationLogPage,
    }
  })
}
