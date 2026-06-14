'use server'

import { withPermission } from '@/lib/permissions/core'
import { PERMISSIONS } from '@/lib/permissions/constants'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { resolveActiveOrgId } from '@/lib/tenancy'

export interface CommunicationLog {
  id: string
  createdAt: string
  channel: string
  status: string
  eventType: string
  recipientName: string
  recipientEmail: string | null
  recipientRole: string | null
  subject: string | null
  messagePreview: string | null
  templateKey: string | null
  errorMessage: string | null
  skippedReason: string | null
  sentAt: string | null
  deliveredAt: string | null
  failedAt: string | null
  externalMessageId: string | null
  invoiceId: string | null
  ccRecipients: Array<{ name: string; email?: string | null; role?: string }> | null
}

export interface CommunicationLogFilters {
  channel?: string
  status?: string
  search?: string
  page?: number
  pageSize?: number
}

export interface CommunicationLogResult {
  logs: CommunicationLog[]
  total: number
  page: number
  pageSize: number
  stats: { sent: number; delivered: number; failed: number; skipped: number; total: number }
}

const PAGE_SIZE = 25

/**
 * Paginated, filterable communication history for the active organization.
 * Reads from notification_logs (the authoritative delivery ledger). Admin-only.
 */
export async function getCommunicationLogs(filters: CommunicationLogFilters = {}) {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async () => {
    const supabase = getSupabaseAdmin()
    const orgId = await resolveActiveOrgId(null)
    const page = Math.max(1, filters.page ?? 1)
    const pageSize = filters.pageSize ?? PAGE_SIZE
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    let query = supabase
      .from('notification_logs')
      .select(
        'id, created_at, channel, status, event_type, recipient_name, recipient_email, recipient_role, subject, message_preview, template_key, error_message, skipped_reason, sent_at, delivered_at, failed_at, external_message_id, invoice_id, cc_recipients',
        { count: 'exact' }
      )
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })

    if (filters.channel && filters.channel !== 'all') query = query.eq('channel', filters.channel)
    if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status)
    if (filters.search) {
      const s = `%${filters.search}%`
      query = query.or(`recipient_name.ilike.${s},recipient_email.ilike.${s},subject.ilike.${s}`)
    }

    const { data, count, error } = await query.range(from, to)
    if (error) {
      return {
        success: false as const,
        error: error.message,
      }
    }

    // Status breakdown across the whole org (not just this page).
    const { data: statRows } = await supabase
      .from('notification_logs')
      .select('status')
      .eq('organization_id', orgId)

    const stats = { sent: 0, delivered: 0, failed: 0, skipped: 0, total: 0 }
    for (const row of statRows ?? []) {
      stats.total += 1
      const st = row.status as keyof typeof stats
      if (st in stats && st !== 'total') stats[st] += 1
    }

    const logs: CommunicationLog[] = (data ?? []).map((r) => ({
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
      templateKey: r.template_key,
      errorMessage: r.error_message,
      skippedReason: r.skipped_reason,
      sentAt: r.sent_at,
      deliveredAt: r.delivered_at,
      failedAt: r.failed_at,
      externalMessageId: r.external_message_id,
      invoiceId: r.invoice_id,
      ccRecipients: (r.cc_recipients as CommunicationLog['ccRecipients']) ?? null,
    }))

    const result: CommunicationLogResult = { logs, total: count ?? 0, page, pageSize, stats }
    return { success: true as const, ...result }
  })
}
