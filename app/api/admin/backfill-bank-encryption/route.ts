import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/permissions/protect-route'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { encrypt, lastFour, isBankEncryptionAvailable } from '@/lib/security/crypto'

// Node runtime for the service-role client + node:crypto.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * One-time (idempotent) backfill that encrypts any legacy plaintext banking
 * data on `contractors`, populates last4, and NULLs the plaintext columns.
 *
 * - Admin only (requireAdmin redirects non-admins).
 * - No-ops safely if BANK_ENCRYPTION_KEY is not configured.
 * - Re-runnable: only touches rows that still have plaintext present.
 *
 * POST /api/admin/backfill-bank-encryption
 */
export async function POST() {
  await requireAdmin()

  if (!isBankEncryptionAvailable()) {
    return NextResponse.json(
      { ok: false, error: 'BANK_ENCRYPTION_KEY is not configured. Set it before running the backfill.' },
      { status: 400 },
    )
  }

  const admin = getSupabaseAdmin()

  // Pull rows that still carry plaintext in any of the three sensitive fields.
  const { data: rows, error } = await admin
    .from('contractors')
    .select('id, bank_account_number, bank_transit_number, bank_institution_number, bank_account_last4')
    .or(
      'bank_account_number.not.is.null,bank_transit_number.not.is.null,bank_institution_number.not.is.null',
    )

  if (error) {
    console.error('[backfill-bank] query error:', error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  let migrated = 0
  const failures: string[] = []

  for (const r of rows || []) {
    const account = (r.bank_account_number as string) || ''
    const transit = (r.bank_transit_number as string) || ''
    const institution = (r.bank_institution_number as string) || ''

    const update: Record<string, unknown> = {
      bank_account_number: null,
      bank_transit_number: null,
      bank_institution_number: null,
    }

    if (account) {
      update.bank_account_encrypted = encrypt(account)
      update.bank_account_last4 = (r.bank_account_last4 as string) || lastFour(account)
    }
    if (transit) update.bank_transit_encrypted = encrypt(transit)
    if (institution) update.bank_institution_encrypted = encrypt(institution)

    const { error: updErr } = await admin.from('contractors').update(update).eq('id', r.id as string)
    if (updErr) {
      console.error(`[backfill-bank] update failed for ${r.id}:`, updErr)
      failures.push(r.id as string)
    } else {
      migrated += 1
    }
  }

  return NextResponse.json({
    ok: failures.length === 0,
    scanned: rows?.length ?? 0,
    migrated,
    failures,
  })
}
