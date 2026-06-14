'use server'

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { encrypt, lastFour, isBankEncryptionAvailable, maskAccount } from '@/lib/security/crypto'
import { sendGenericAlert } from '@/lib/notifications/server-dispatch'

/**
 * Banking changes never mutate `contractors` directly. A contractor submits a
 * change request (pending), an admin/accountant reviews it, and only on
 * approval are the encrypted values applied to `contractors` with a full audit
 * trail. All account data is encrypted at rest; only last-4 is kept in clear.
 */

export interface BankingChangeInput {
  bankName: string
  transitNumber: string
  institutionNumber: string
  accountNumber: string
  /** optional new void cheque already uploaded to vendor_kyc_documents */
  voidChequeDocumentId?: string | null
}

/**
 * Contractor: submit a banking change request. Creates a pending row and
 * notifies internal reviewers. Scoped by auth_user_id (IDOR-safe).
 */
export async function submitBankingChangeRequest(input: BankingChangeInput) {
  try {
    if (!isBankEncryptionAvailable()) {
      return {
        success: false,
        error: 'Banking changes are temporarily unavailable. Please contact support.',
      }
    }

    if (!input.accountNumber?.trim() || !input.transitNumber?.trim() || !input.institutionNumber?.trim()) {
      return { success: false, error: 'Transit, institution, and account numbers are all required.' }
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Unauthorized' }

    const admin = getSupabaseAdmin()
    const { data: contractor } = await admin
      .from('contractors')
      .select('id, company_name, bank_name, bank_account_last4')
      .eq('auth_user_id', user.id)
      .single()

    if (!contractor) return { success: false, error: 'Contractor profile not found' }

    // Reject duplicate in-flight requests to keep the reviewer queue clean.
    const { data: existingPending } = await admin
      .from('banking_change_requests')
      .select('id')
      .eq('contractor_id', contractor.id)
      .eq('status', 'pending')
      .maybeSingle()

    if (existingPending) {
      return {
        success: false,
        error: 'You already have a pending banking change awaiting review.',
      }
    }

    const { error: insertError } = await admin.from('banking_change_requests').insert({
      contractor_id: contractor.id,
      requested_by_auth_user_id: user.id,
      status: 'pending',
      new_bank_name: input.bankName || null,
      new_account_encrypted: encrypt(input.accountNumber),
      new_transit_encrypted: encrypt(input.transitNumber),
      new_institution_encrypted: encrypt(input.institutionNumber),
      new_account_last4: lastFour(input.accountNumber),
      old_bank_name: (contractor.bank_name as string) ?? null,
      old_account_last4: (contractor.bank_account_last4 as string) ?? null,
      void_cheque_document_id: input.voidChequeDocumentId || null,
    })

    if (insertError) {
      console.error('submitBankingChangeRequest insert error:', insertError)
      return { success: false, error: insertError.message }
    }

    // Notify internal reviewers (admins + accountants).
    await notifyReviewers(
      admin,
      'Banking change requested',
      `${contractor.company_name || 'A contractor'} requested a banking update (••••${lastFour(input.accountNumber) ?? '????'}). Review required before payments use the new account.`,
      '/accountant/banking-changes'
    )

    revalidatePath('/vendor/profile')
    return { success: true }
  } catch (err) {
    console.error('submitBankingChangeRequest error:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

interface InternalActor {
  id: string
  role: string
  name: string
}

/**
 * Resolve the signed-in internal reviewer (admin/accountant) and enforce the
 * role gate. Returns null when the caller is not authorized.
 */
async function resolveInternalReviewer(
  admin: ReturnType<typeof getSupabaseAdmin>,
  authUserId: string
): Promise<InternalActor | null> {
  const { data: u } = await admin
    .from('users')
    .select('id, role, first_name, last_name')
    .eq('auth_user_id', authUserId)
    .single()

  if (!u) return null
  const role = (u.role as string) || ''
  if (role !== 'admin' && role !== 'accountant') return null

  return {
    id: u.id as string,
    role,
    name: `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || 'Reviewer',
  }
}

/**
 * List pending (and recently decided) banking change requests for reviewers.
 * Never returns decryptable account data — only masked last-4.
 */
export async function listBankingChangeRequests() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, requests: [] }

    const admin = getSupabaseAdmin()
    const reviewer = await resolveInternalReviewer(admin, user.id)
    if (!reviewer) return { success: false, requests: [], error: 'Forbidden' }

    const { data, error } = await admin
      .from('banking_change_requests')
      .select(
        'id, status, contractor_id, new_bank_name, new_account_last4, old_bank_name, old_account_last4, void_cheque_document_id, reason, created_at, decided_at, contractor:contractors(company_name, contact_name, email)'
      )
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      console.error('listBankingChangeRequests error:', error)
      return { success: false, requests: [] }
    }

    const requests = (data || []).map((r) => {
      // Supabase types embedded relations as arrays; normalize to a single row.
      const rawContractor = r.contractor as unknown
      const c = (Array.isArray(rawContractor) ? rawContractor[0] : rawContractor) as
        | Record<string, unknown>
        | null
      return {
        id: r.id as string,
        status: r.status as string,
        contractorId: r.contractor_id as string,
        companyName: (c?.company_name as string) ?? 'Unknown',
        contactName: (c?.contact_name as string) ?? null,
        email: (c?.email as string) ?? null,
        newBankName: (r.new_bank_name as string) ?? null,
        newAccountMasked: maskAccount(r.new_account_last4 as string),
        oldBankName: (r.old_bank_name as string) ?? null,
        oldAccountMasked: maskAccount(r.old_account_last4 as string),
        hasVoidCheque: Boolean(r.void_cheque_document_id),
        reason: (r.reason as string) ?? null,
        createdAt: r.created_at as string,
        decidedAt: (r.decided_at as string) ?? null,
      }
    })

    return { success: true, requests }
  } catch (err) {
    console.error('listBankingChangeRequests error:', err)
    return { success: false, requests: [] }
  }
}

/**
 * Reviewer: approve a banking change request. Applies the encrypted values to
 * the contractor, writes an audit log, marks the request approved, and
 * notifies the contractor. Plaintext legacy columns are cleared on apply.
 */
export async function approveBankingChangeRequest(requestId: string) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Unauthorized' }

    const admin = getSupabaseAdmin()
    const reviewer = await resolveInternalReviewer(admin, user.id)
    if (!reviewer) return { success: false, error: 'Forbidden' }

    const { data: req } = await admin
      .from('banking_change_requests')
      .select('*')
      .eq('id', requestId)
      .single()

    if (!req) return { success: false, error: 'Request not found' }
    if (req.status !== 'pending') return { success: false, error: 'This request has already been decided.' }

    // Apply encrypted values; clear legacy plaintext columns.
    const { error: applyError } = await admin
      .from('contractors')
      .update({
        bank_name: req.new_bank_name,
        bank_account_encrypted: req.new_account_encrypted,
        bank_transit_encrypted: req.new_transit_encrypted,
        bank_institution_encrypted: req.new_institution_encrypted,
        bank_account_last4: req.new_account_last4,
        bank_account_number: null,
        bank_transit_number: null,
        bank_institution_number: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.contractor_id)

    if (applyError) {
      console.error('approveBankingChangeRequest apply error:', applyError)
      return { success: false, error: applyError.message }
    }

    await admin
      .from('banking_change_requests')
      .update({ status: 'approved', decided_by: reviewer.id, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', requestId)

    // Audit trail (no account numbers — masked only).
    await admin.from('audit_logs').insert({
      action: 'update',
      entity_type: 'contractor_banking',
      entity_id: req.contractor_id,
      user_id: reviewer.id,
      user_role: reviewer.role,
      description: `Approved banking change (••••${req.new_account_last4 ?? '????'}) for contractor ${req.contractor_id}`,
      old_values: { bank_name: req.old_bank_name, account_last4: req.old_account_last4 },
      new_values: { bank_name: req.new_bank_name, account_last4: req.new_account_last4 },
    })

    await notifyContractor(
      admin,
      req.contractor_id as string,
      'Banking update approved',
      `Your banking change (••••${req.new_account_last4 ?? '????'}) has been approved and is now on file.`,
      '/vendor/profile'
    )

    revalidatePath('/accountant/banking-changes')
    return { success: true }
  } catch (err) {
    console.error('approveBankingChangeRequest error:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

/**
 * Reviewer: reject a banking change request with a reason. Contractor banking
 * is left unchanged. Notifies the contractor.
 */
export async function rejectBankingChangeRequest(requestId: string, reason: string) {
  try {
    if (!reason?.trim()) return { success: false, error: 'A rejection reason is required.' }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Unauthorized' }

    const admin = getSupabaseAdmin()
    const reviewer = await resolveInternalReviewer(admin, user.id)
    if (!reviewer) return { success: false, error: 'Forbidden' }

    const { data: req } = await admin
      .from('banking_change_requests')
      .select('id, status, contractor_id, new_account_last4')
      .eq('id', requestId)
      .single()

    if (!req) return { success: false, error: 'Request not found' }
    if (req.status !== 'pending') return { success: false, error: 'This request has already been decided.' }

    await admin
      .from('banking_change_requests')
      .update({
        status: 'rejected',
        reason: reason.trim(),
        decided_by: reviewer.id,
        decided_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)

    await admin.from('audit_logs').insert({
      action: 'update',
      entity_type: 'contractor_banking',
      entity_id: req.contractor_id,
      user_id: reviewer.id,
      user_role: reviewer.role,
      description: `Rejected banking change request for contractor ${req.contractor_id}: ${reason.trim()}`,
    })

    await notifyContractor(
      admin,
      req.contractor_id as string,
      'Banking update not approved',
      `Your banking change request was not approved. Reason: ${reason.trim()}`,
      '/vendor/profile'
    )

    revalidatePath('/accountant/banking-changes')
    return { success: true }
  } catch (err) {
    console.error('rejectBankingChangeRequest error:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

// ---- notification helpers -------------------------------------------------

async function notifyReviewers(
  admin: ReturnType<typeof getSupabaseAdmin>,
  title: string,
  body: string,
  link: string
) {
  try {
    const { data: reviewers } = await admin
      .from('users')
      .select('id, email, phone, email_notifications_enabled, sms_notifications_enabled, notification_email, notification_phone')
      .in('role', ['admin', 'accountant'])
      .eq('is_active', true)

    for (const r of reviewers || []) {
      await sendGenericAlert({
        recipientUserId: r.id as string,
        recipient: {
          name: 'Reviewer',
          email: (r.notification_email as string) || (r.email as string) || undefined,
          phone: (r.notification_phone as string) || (r.phone as string) || undefined,
          emailEnabled: r.email_notifications_enabled !== false,
          smsEnabled: Boolean(r.sms_notifications_enabled),
        },
        type: 'banking_change_requested',
        title,
        body,
        link,
      })
    }
  } catch (e) {
    console.error('notifyReviewers error:', e)
  }
}

async function notifyContractor(
  admin: ReturnType<typeof getSupabaseAdmin>,
  contractorId: string,
  title: string,
  body: string,
  link: string
) {
  try {
    const { data: contractor } = await admin
      .from('contractors')
      .select('auth_user_id, email, phone')
      .eq('id', contractorId)
      .single()

    if (!contractor) return

    // Map auth user -> internal users row for the in-app feed (if one exists).
    let recipientUserId: string | null = null
    if (contractor.auth_user_id) {
      const { data: u } = await admin
        .from('users')
        .select('id')
        .eq('auth_user_id', contractor.auth_user_id)
        .maybeSingle()
      recipientUserId = (u?.id as string) ?? null
    }

    await sendGenericAlert({
      recipientUserId,
      recipient: {
        name: 'Contractor',
        email: (contractor.email as string) ?? undefined,
        phone: (contractor.phone as string) ?? undefined,
        emailEnabled: true,
        smsEnabled: Boolean(contractor.phone),
      },
      type: 'banking_change_decision',
      title,
      body,
      link,
    })
  } catch (e) {
    console.error('notifyContractor error:', e)
  }
}
