'use server'

import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { resolveInternalUserId } from '@/lib/utils/resolve-user'

export interface NotificationItem {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  invoiceId: string | null
  read: boolean
  createdAt: string
}

/**
 * Fetch the signed-in user's most recent in-app notifications (newest first).
 * Scoped strictly to their internal users.id via recipient_user_id.
 */
export async function getNotifications(
  limit = 20,
): Promise<{ success: boolean; notifications: NotificationItem[]; unread: number; error?: string }> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { success: false, notifications: [], unread: 0, error: 'Unauthorized' }

    const admin = getSupabaseAdmin()
    const userId = await resolveInternalUserId(user.id, admin)
    if (!userId) return { success: false, notifications: [], unread: 0, error: 'User not found' }

    const { data, error } = await admin
      .from('notifications')
      .select('id, type, title, body, link, invoice_id, read_at, created_at')
      .eq('recipient_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[notifications] list error:', error)
      return { success: false, notifications: [], unread: 0, error: error.message }
    }

    const notifications: NotificationItem[] = (data || []).map((n) => ({
      id: n.id as string,
      type: (n.type as string) ?? 'general',
      title: (n.title as string) ?? '',
      body: (n.body as string) ?? null,
      link: (n.link as string) ?? null,
      invoiceId: (n.invoice_id as string) ?? null,
      read: Boolean(n.read_at),
      createdAt: n.created_at as string,
    }))

    const unread = notifications.filter((n) => !n.read).length
    return { success: true, notifications, unread }
  } catch (err) {
    console.error('[notifications] list exception:', err)
    return { success: false, notifications: [], unread: 0, error: 'An unexpected error occurred' }
  }
}

/**
 * Lightweight unread-count read for the bell badge polling.
 */
export async function getUnreadCount(): Promise<{ success: boolean; count: number }> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { success: false, count: 0 }

    const admin = getSupabaseAdmin()
    const userId = await resolveInternalUserId(user.id, admin)
    if (!userId) return { success: false, count: 0 }

    const { count, error } = await admin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_user_id', userId)
      .is('read_at', null)

    if (error) {
      console.error('[notifications] unread count error:', error)
      return { success: false, count: 0 }
    }
    return { success: true, count: count ?? 0 }
  } catch (err) {
    console.error('[notifications] unread count exception:', err)
    return { success: false, count: 0 }
  }
}

/**
 * Mark a single notification read. Ownership-guarded by recipient_user_id.
 */
export async function markNotificationRead(
  notificationId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Unauthorized' }

    const admin = getSupabaseAdmin()
    const userId = await resolveInternalUserId(user.id, admin)
    if (!userId) return { success: false, error: 'User not found' }

    const { error } = await admin
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notificationId)
      .eq('recipient_user_id', userId)
      .is('read_at', null)

    if (error) {
      console.error('[notifications] mark read error:', error)
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (err) {
    console.error('[notifications] mark read exception:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

/**
 * Mark all of the user's unread notifications read.
 */
export async function markAllNotificationsRead(): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Unauthorized' }

    const admin = getSupabaseAdmin()
    const userId = await resolveInternalUserId(user.id, admin)
    if (!userId) return { success: false, error: 'User not found' }

    const { error } = await admin
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_user_id', userId)
      .is('read_at', null)

    if (error) {
      console.error('[notifications] mark all read error:', error)
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (err) {
    console.error('[notifications] mark all read exception:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}
