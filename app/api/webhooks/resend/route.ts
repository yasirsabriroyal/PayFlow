import { NextResponse } from 'next/server'
import { Webhook } from 'svix'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/**
 * Resend delivery webhook.
 *
 * Resend POSTs delivery lifecycle events (sent, delivered, bounced, complained,
 * delivery_delayed) signed with Svix. We verify the signature (when
 * RESEND_WEBHOOK_SECRET is configured) and reconcile the matching
 * notification_logs row by external_message_id so the Communication History UI
 * reflects TRUE delivery state — not just "we handed it to the provider".
 *
 * Configure the endpoint in Resend → Webhooks pointing at:
 *   https://<your-domain>/api/webhooks/resend
 */

// Raw body + crypto signature verification require the Node runtime, and the
// endpoint must never be statically cached.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET

// Map Resend event types onto our notification_status enum + timestamp column.
type ResendEventType =
  | 'email.sent'
  | 'email.delivered'
  | 'email.delivery_delayed'
  | 'email.bounced'
  | 'email.complained'
  | 'email.opened'
  | 'email.clicked'

interface ResendEvent {
  type: ResendEventType
  created_at?: string
  data?: {
    email_id?: string
    // bounce / complaint detail when present
    bounce?: { message?: string; type?: string }
    reason?: string
  }
}

interface LogUpdate {
  status?: string
  delivered_at?: string
  failed_at?: string
  error_message?: string
  updated_at: string
}

function mapEvent(event: ResendEvent, now: string): LogUpdate | null {
  switch (event.type) {
    case 'email.delivered':
      return { status: 'delivered', delivered_at: event.created_at || now, updated_at: now }
    case 'email.bounced':
      return {
        status: 'failed',
        failed_at: event.created_at || now,
        error_message: event.data?.bounce?.message || event.data?.reason || 'Email bounced',
        updated_at: now,
      }
    case 'email.complained':
      return {
        status: 'failed',
        failed_at: event.created_at || now,
        error_message: 'Recipient marked the message as spam',
        updated_at: now,
      }
    // sent/delayed/opened/clicked don't change our terminal status; ignore them
    // so we never downgrade a 'delivered' row back to 'sent'.
    default:
      return null
  }
}

export async function POST(request: Request) {
  const payload = await request.text()

  // Verify the Svix signature when a secret is configured. If no secret is set
  // (e.g. local/dev), accept the payload but log a warning.
  if (WEBHOOK_SECRET) {
    const headers = {
      'svix-id': request.headers.get('svix-id') ?? '',
      'svix-timestamp': request.headers.get('svix-timestamp') ?? '',
      'svix-signature': request.headers.get('svix-signature') ?? '',
    }
    try {
      const wh = new Webhook(WEBHOOK_SECRET)
      wh.verify(payload, headers)
    } catch {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  } else {
    console.warn('[resend-webhook] RESEND_WEBHOOK_SECRET not set — skipping signature verification')
  }

  let event: ResendEvent
  try {
    event = JSON.parse(payload) as ResendEvent
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const emailId = event.data?.email_id
  if (!emailId) {
    // Nothing to correlate — acknowledge so Resend doesn't retry.
    return NextResponse.json({ ok: true, ignored: 'no email_id' })
  }

  const now = new Date().toISOString()
  const update = mapEvent(event, now)
  if (!update) {
    return NextResponse.json({ ok: true, ignored: event.type })
  }

  try {
    const supabase = getSupabaseAdmin()
    const { error } = await supabase
      .from('notification_logs')
      .update(update)
      .eq('external_message_id', emailId)
    if (error) {
      console.error('[resend-webhook] update failed:', error.message)
      return NextResponse.json({ error: 'update failed' }, { status: 500 })
    }
  } catch (e) {
    console.error('[resend-webhook] handler error:', e)
    return NextResponse.json({ error: 'handler error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
