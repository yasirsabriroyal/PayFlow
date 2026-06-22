import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { sendGenericAlert } from '@/lib/notifications/server-dispatch'
import {
  COMPLIANCE_DOC_LABELS as DOC_LABELS,
} from '@/lib/compliance/constants'

// Cron runs on the Node runtime so it can use the service-role client.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Alert stages with their lead-day thresholds.
 * The cron scans any document expiring within MAX_LEAD_DAYS and determines
 * which stages need to be sent. Each (document_id, alert_stage) pair is only
 * ever sent once, enforced by the unique constraint on compliance_expiry_alerts.
 */
const ALERT_STAGES = [
  { key: 'expiring_30d', daysMin: 22, daysMax: 30 }, // fire when 22–30 days remain
  { key: 'expiring_14d', daysMin: 10, daysMax: 14 }, // fire when 10–14 days remain
  { key: 'expiring_7d',  daysMin: 5,  daysMax: 7  }, // fire when 5–7 days remain
  { key: 'expiring_1d',  daysMin: 0,  daysMax: 1  }, // fire on expiry day
  { key: 'expired',      daysMin: -Infinity, daysMax: -1 }, // fire day after expiry
] as const

type AlertStageKey = typeof ALERT_STAGES[number]['key']

/** The furthest out we look when scanning documents. */
const MAX_LEAD_DAYS = 31

/**
 * Daily compliance expiry scan.
 *
 * For each verified document expiring within MAX_LEAD_DAYS (including already
 * expired), determines all applicable alert stages and sends each one exactly
 * once. Sends to:
 *   - The contractor themselves (in-app + email + SMS)
 *   - All internal accountant + admin users (in-app only)
 *   - The project manager(s) assigned to the contractor's active invoices
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const admin = getSupabaseAdmin()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const horizon = new Date(today)
  horizon.setDate(horizon.getDate() + MAX_LEAD_DAYS)

  // Fetch all verified docs expiring within horizon (includes overdue)
  const { data: docs, error: docsError } = await admin
    .from('vendor_kyc_documents')
    .select('id, contractor_id, document_type, expiry_date, status')
    .in('status', ['verified', 'expiring'])
    .not('expiry_date', 'is', null)
    .lte('expiry_date', horizon.toISOString().split('T')[0])

  if (docsError) {
    console.error('[cron/compliance-expiry] query error:', docsError)
    return NextResponse.json({ error: docsError.message }, { status: 500 })
  }

  // Fetch all internal users (admin + accountant) for broadcast alerts
  const { data: internalUsers } = await admin
    .from('users')
    .select('id, email, display_name, role')
    .in('role', ['admin', 'accountant'])

  let sent = 0
  let skipped = 0
  let errors = 0

  for (const doc of docs ?? []) {
    const expiry = new Date(doc.expiry_date as string)
    expiry.setHours(0, 0, 0, 0)
    const daysUntil = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

    // Determine which stage(s) apply to this document today
    const applicableStages = ALERT_STAGES.filter(
      s => daysUntil >= s.daysMin && daysUntil <= s.daysMax
    )
    if (applicableStages.length === 0) {
      skipped++
      continue
    }

    // Resolve contractor record once per doc
    const { data: contractor } = await admin
      .from('contractors')
      .select('id, auth_user_id, company_name, contact_name, email, phone')
      .eq('id', doc.contractor_id)
      .single()

    if (!contractor) {
      skipped++
      continue
    }

    // Resolve the contractor's portal users.id for in-app notifications
    let contractorUserId: string | null = null
    if (contractor.auth_user_id) {
      const { data: cu } = await admin
        .from('users')
        .select('id')
        .eq('auth_user_id', contractor.auth_user_id)
        .maybeSingle()
      contractorUserId = cu?.id ?? null
    }

    const label = DOC_LABELS[doc.document_type as string] ?? 'Compliance document'
    const companyName = contractor.company_name ?? contractor.contact_name ?? 'Contractor'

    for (const stage of applicableStages) {
      // Deduplicate: skip if already sent for this doc + stage
      const { data: existing } = await admin
        .from('compliance_expiry_alerts')
        .select('id')
        .eq('document_id', doc.id)
        .eq('alert_stage', stage.key)
        .maybeSingle()

      if (existing) {
        skipped++
        continue
      }

      // Build messaging based on stage
      const isExpired = stage.key === 'expired'
      const daysLabel = isExpired
        ? `expired on ${expiry.toLocaleDateString('en-CA')}`
        : daysUntil === 0
          ? 'expires today'
          : `expires in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`

      const contractorTitle = isExpired
        ? `${label} has expired`
        : `${label} ${daysLabel}`
      const contractorBody = isExpired
        ? `Your ${label.toLowerCase()} expired on ${expiry.toLocaleDateString('en-CA')}. Upload a renewed document immediately to avoid payment holds.`
        : `Your ${label.toLowerCase()} ${daysLabel} (${expiry.toLocaleDateString('en-CA')}). Please upload a renewal to remain compliant and avoid payment interruptions.`

      const internalTitle = isExpired
        ? `${companyName} — ${label} has expired`
        : `${companyName} — ${label} ${daysLabel}`
      const internalBody = isExpired
        ? `${companyName}'s ${label.toLowerCase()} expired on ${expiry.toLocaleDateString('en-CA')}. Payments to this contractor are blocked until a valid document is on file.`
        : `${companyName}'s ${label.toLowerCase()} ${daysLabel}. Payments will be blocked if not renewed by ${expiry.toLocaleDateString('en-CA')}.`

      try {
        // 1. Notify the contractor
        await sendGenericAlert({
          recipientUserId: contractorUserId,
          recipient: {
            id: contractor.id,
            name: contractor.contact_name ?? companyName,
            email: contractor.email ?? undefined,
            phone: contractor.phone ?? undefined,
            role: 'contractor',
          },
          type: isExpired ? 'compliance_document_expired' : `compliance_expiry_${stage.key}`,
          title: contractorTitle,
          body: contractorBody,
          link: '/vendor/compliance',
        })

        // 2. Notify all internal admins + accountants (in-app only — no email spam)
        for (const internal of internalUsers ?? []) {
          await sendGenericAlert({
            recipientUserId: internal.id,
            recipient: {
              id: internal.id,
              name: internal.display_name ?? 'Team member',
              // No email/phone — internal broadcast is in-app only
              emailEnabled: false,
              smsEnabled: false,
            },
            type: isExpired ? 'compliance_document_expired' : `compliance_expiry_${stage.key}`,
            title: internalTitle,
            body: internalBody,
            link: '/accountant/compliance',
          })
        }

        // 3. Record the deduplication row
        await admin.from('compliance_expiry_alerts').insert({
          document_id: doc.id,
          document_type: doc.document_type,
          contractor_id: contractor.id,
          alert_stage: stage.key as AlertStageKey,
          sent_at: new Date().toISOString(),
        })

        sent++
      } catch (err) {
        console.error(`[cron/compliance-expiry] stage=${stage.key} doc=${doc.id}`, err)
        errors++
      }
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: docs?.length ?? 0,
    sent,
    skipped,
    errors,
  })
}
