'use server'

import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

export interface InvoiceHistoryEntry {
  id: string
  oldStatus: string | null
  newStatus: string
  changedByName: string | null
  changedByRole: string | null
  reason: string | null
  createdAt: string
}

/**
 * Return the full status history for an invoice, oldest first.
 *
 * Ownership guard (the service-role client bypasses RLS, so we enforce here):
 *  - staff (admin / accountant / project_manager) may view any invoice's history
 *  - a contractor may only view history for invoices belonging to their own
 *    contractor record
 */
export async function getInvoiceStatusHistory(
  invoiceId: string,
): Promise<{ success: boolean; history: InvoiceHistoryEntry[]; error?: string }> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { success: false, history: [], error: 'Unauthorized' }

    const admin = getSupabaseAdmin()

    // Resolve the caller's role to decide the access path.
    const { data: userRow } = await admin
      .from('users')
      .select('id, role')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    const role = userRow?.role as string | undefined
    const isStaff = role === 'admin' || role === 'accountant' || role === 'project_manager'

    if (!isStaff) {
      // Contractor path: the invoice must belong to their contractor record.
      const { data: contractor } = await admin
        .from('contractors')
        .select('id')
        .eq('auth_user_id', user.id)
        .maybeSingle()

      if (!contractor) return { success: false, history: [], error: 'Not authorized' }

      const { data: invoice } = await admin
        .from('invoices')
        .select('id, contractor_id')
        .eq('id', invoiceId)
        .maybeSingle()

      if (!invoice || invoice.contractor_id !== contractor.id) {
        return { success: false, history: [], error: 'Invoice not found' }
      }
    }

    const { data, error } = await admin
      .from('invoice_status_history')
      .select('id, old_status, new_status, changed_by_name, changed_by_role, reason, created_at')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[invoice-history] query error:', error)
      return { success: false, history: [], error: error.message }
    }

    const history: InvoiceHistoryEntry[] = (data || []).map((h) => ({
      id: h.id as string,
      oldStatus: (h.old_status as string) ?? null,
      newStatus: (h.new_status as string) ?? '',
      changedByName: (h.changed_by_name as string) ?? null,
      changedByRole: (h.changed_by_role as string) ?? null,
      reason: (h.reason as string) ?? null,
      createdAt: h.created_at as string,
    }))

    return { success: true, history }
  } catch (err) {
    console.error('[invoice-history] exception:', err)
    return { success: false, history: [], error: 'An unexpected error occurred' }
  }
}
