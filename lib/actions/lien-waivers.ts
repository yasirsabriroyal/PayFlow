'use server'

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export async function getVendorLienWaivers() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return { success: false, waivers: [] }

    const adminSupabase = getSupabaseAdmin()

    const { data: contractor } = await adminSupabase
      .from('contractors')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()

    if (!contractor) return { success: false, waivers: [] }

    // Fetch invoices that have been paid
    const { data: invoices, error } = await adminSupabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        total_cents,
        invoice_date,
        project:projects(name),
        payment_requests(id, status, lien_waivers(id, is_signed, waiver_type, signed_at))
      `)
      .eq('contractor_id', contractor.id)
      .eq('status', 'paid')

    if (error) {
      console.error('Error fetching lien waivers:', error)
      return { success: false, waivers: [] }
    }

    // Format the response for the frontend
    const waivers = (invoices || []).map((inv: any) => {
      // Find a payment request that has an associated lien waiver, or just assume the first one
      const pr = inv.payment_requests && inv.payment_requests[0]
      const lw = pr && pr.lien_waivers && pr.lien_waivers[0]
      
      return {
        id: lw ? lw.id : inv.id, // Fallback to invoice id if no actual waiver record exists yet
        payment_request_id: pr ? pr.id : null,
        invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        project_name: inv.project?.name || 'Unknown Project',
        amount_cents: inv.total_cents,
        payment_date: inv.invoice_date, // Using invoice date as placeholder for payment date
        status: lw && lw.is_signed ? 'signed' : 'pending',
        waiver_type: lw ? lw.waiver_type : 'progress',
        signed_at: lw ? lw.signed_at : null
      }
    })

    return { success: true, waivers }
  } catch (err) {
    console.error('Lien waivers error:', err)
    return { success: false, waivers: [] }
  }
}

export async function signLienWaiver(paymentRequestId: string, signatureData: string) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return { success: false, error: 'Unauthorized' }

    const adminSupabase = getSupabaseAdmin()

    const { data: contractor } = await adminSupabase
      .from('contractors')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()

    if (!contractor) return { success: false, error: 'Contractor not found' }

    // IDOR guard: confirm the payment request belongs to this contractor before
    // allowing them to sign a waiver against it. This action uses the
    // service-role client (RLS bypassed), so this check is the enforcement layer.
    const { data: paymentRequest, error: prOwnerError } = await adminSupabase
      .from('payment_requests')
      .select('id, project_id, requested_amount_cents, contractor_id')
      .eq('id', paymentRequestId)
      .maybeSingle()

    if (prOwnerError) {
      console.error('[v0] Payment request ownership lookup failed:', prOwnerError)
      return { success: false, error: 'Unable to verify payment request' }
    }

    if (!paymentRequest || paymentRequest.contractor_id !== contractor.id) {
      return { success: false, error: 'Payment request not found' }
    }

    // We assume the lien waiver record already exists, or we create it here
    // In a real app, the PM would create the waiver request when approving payment.
    // For this prototype, if it doesn't exist, we could insert it, but for now
    // let's assume we update the existing record or insert if missing.
    
    // First try to find existing
    const { data: existing } = await adminSupabase
      .from('lien_waivers')
      .select('id')
      .eq('payment_request_id', paymentRequestId)
      .single()

    if (existing) {
      const { error: updateError } = await adminSupabase
        .from('lien_waivers')
        .update({
          is_signed: true,
          signed_at: new Date().toISOString(),
          signature_data: signatureData
        })
        .eq('id', existing.id)

      if (updateError) {
        console.error('[v0] Lien waiver update failed:', updateError)
        return { success: false, error: 'Failed to record signature.' }
      }
    } else {
      const { error: insertError } = await adminSupabase
        .from('lien_waivers')
        .insert({
          payment_request_id: paymentRequestId,
          contractor_id: contractor.id,
          project_id: paymentRequest.project_id,
          amount_cents: paymentRequest.requested_amount_cents,
          waiver_type: 'progress',
          is_signed: true,
          signed_at: new Date().toISOString(),
          signature_data: signatureData,
          valid_through_date: new Date().toISOString().split('T')[0]
        })

      if (insertError) {
        console.error('[v0] Lien waiver insert failed:', insertError)
        return { success: false, error: 'Failed to create lien waiver record.' }
      }
    }

    return { success: true }
  } catch (err) {
    console.error('Sign waiver error:', err)
    return { success: false, error: 'Failed to sign waiver' }
  }
}
