'use server'

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export async function getVendorPortalStats() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return { success: false, stats: null }

    const adminSupabase = getSupabaseAdmin()

    const { data: contractor } = await adminSupabase
      .from('contractors')
      .select('*')
      .eq('auth_user_id', user.id)
      .single()

    if (!contractor) return { success: false, stats: null }

    // Fetch invoices
    const { data: invoices } = await adminSupabase
      .from('invoices')
      .select('status, total_cents, holdback_cents')
      .eq('contractor_id', contractor.id)

    const pendingReviewCount = (invoices || []).filter(inv => inv.status === 'submitted' || inv.status === 'pending_approval').length
    const approvedCount = (invoices || []).filter(inv => inv.status === 'approved').length

    // Fetch payments for this month
    const currentMonth = new Date()
    currentMonth.setDate(1)
    const { data: payments } = await adminSupabase
      .from('payments')
      .select('amount_cents, payment_date')
      .eq('contractor_id', contractor.id)
      .gte('payment_date', currentMonth.toISOString().split('T')[0])
      
    const paidThisMonthCents = (payments || []).reduce((sum, p) => sum + p.amount_cents, 0)

    // Fetch holdback
    const { data: holdbacks } = await adminSupabase
      .from('holdback_ledgers')
      .select('holdback_amount_cents, released_amount_cents, status')
      .eq('contractor_id', contractor.id)
      
    // Outstanding balance = total withheld minus what has been released
    let holdbackBalanceCents = 0
    if (holdbacks && holdbacks.length > 0) {
      holdbackBalanceCents = holdbacks.reduce((sum, h) => {
        return sum + ((h.holdback_amount_cents || 0) - (h.released_amount_cents || 0))
      }, 0)
    } else {
      // Fallback to summing holdback_cents from invoices if ledger is empty
      holdbackBalanceCents = (invoices || []).reduce((sum, inv) => sum + (inv.holdback_cents || 0), 0)
    }

    return {
      success: true,
      stats: {
        pendingReviewCount,
        approvedCount,
        paidThisMonthCents,
        holdbackBalanceCents,
        wcbStatus: contractor.status === 'active' ? 'Valid' : 'Pending',
        wcbExpiry: contractor.wcb_clearance_expiry || 'N/A'
      }
    }
  } catch (err) {
    console.error('Portal stats error:', err)
    return { success: false, stats: null }
  }
}
