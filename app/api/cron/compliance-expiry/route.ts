import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { sendGenericAlert } from '@/lib/notifications/server-dispatch'
import { COMPLIANCE_EXPIRY_LEAD_DAYS } from '@/lib/actions/vendor-portal'

// Cron runs on the Node runtime so it can use the service-role client.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DOC_LABELS: Record<string, string> = {
  wcb_clearance: 'WCB Clearance',
  insurance_certificate: 'Insurance Certificate',
  business_license: 'Trade / Business License',
  safety_certification: 'Safety Certification',
}

/**
 * Daily scan for compliance documents that are expiring within
 * COMPLIANCE_EXPIRY_LEAD_DAYS or already expired. Sends one in-app + email/SMS
 * alert per document per stage (expiring, then expired), deduped via the
 * compliance_expiry_alerts table so contractors aren't spammed daily.
 */
export async function GET(request: Request) {
  // Authorize: Vercel Cron sends the configured CRON_SECRET as a Bearer token.
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const admin = getSupabaseAdmin()
  const today = new Date()
  const horizon = new Date()
  horizon.setDate(horizon.getDate() + COMPLIANCE_EXPIRY_LEAD_DAYS)

  // Verified docs with an expiry within the warning horizon (includes overdue).
  const { data: docs, error } = await admin
    .from('vendor_kyc_documents')
    .select('id, contractor_id, document_type, expiry_date, status')
    .eq('status', 'verified')
    .not('expiry_date', 'is', null)
    .lte('expiry_date', horizon.toISOString().split('T')[0])

  if (error) {
    console.error('[cron/compliance-expiry] query error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let sent = 0
  let skipped = 0

  for (const doc of docs || []) {
    const expiry = new Date(doc.expiry_date as string)
    const daysUntil = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    const stage: 'expiring' | 'expired' = daysUntil < 0 ? 'expired' : 'expiring'

    // Dedupe: skip if we already alerted for this doc + stage.
    const { data: existing } = await admin
      .from('compliance_expiry_alerts')
      .select('id')
      .eq('document_id', doc.id)
      .eq('alert_stage', stage)
      .maybeSingle()

    if (existing) {
      skipped++
      continue
    }

    // Resolve the contractor + their portal user (if any) for delivery.
    const { data: contractor } = await admin
      .from('contractors')
      .select('id, auth_user_id, company_name, contact_name, email, phone')
      .eq('id', doc.contractor_id)
      .single()

    if (!contractor) {
      skipped++
      continue
    }

    let recipientUserId: string | null = null
    if (contractor.auth_user_id) {
      const { data: cu } = await admin
        .from('users')
        .select('id')
        .eq('auth_user_id', contractor.auth_user_id)
        .maybeSingle()
      recipientUserId = cu?.id ?? null
    }

    const label = DOC_LABELS[doc.document_type] || 'Compliance document'
    const title =
      stage === 'expired'
        ? `${label} has expired`
        : `${label} expires in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`
    const body =
      stage === 'expired'
        ? `Your ${label.toLowerCase()} expired on ${expiry.toLocaleDateString('en-CA')}. Upload a current document to avoid payment holds.`
        : `Your ${label.toLowerCase()} expires on ${expiry.toLocaleDateString('en-CA')}. Please upload a renewal to stay compliant.`

    await sendGenericAlert({
      recipientUserId,
      recipient: {
        id: contractor.id,
        name: contractor.contact_name || contractor.company_name || 'Contractor',
        email: contractor.email ?? undefined,
        phone: contractor.phone ?? undefined,
        role: 'contractor',
      },
      type: 'compliance_expiry',
      title,
      body,
      link: '/vendor/compliance',
    })

    await admin.from('compliance_expiry_alerts').insert({
      document_id: doc.id,
      contractor_id: contractor.id,
      alert_stage: stage,
      expiry_date: doc.expiry_date,
    })

    sent++
  }

  return NextResponse.json({ ok: true, scanned: docs?.length ?? 0, sent, skipped })
}
