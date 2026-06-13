/**
 * Server-only notification dispatcher.
 *
 * Unlike `lib/notifications.ts` (which is imported by client components and uses
 * the browser Supabase client), this module runs strictly server-side with the
 * service-role admin client. It is responsible for:
 *   - Writing the user-facing in-app `notifications` row (always, when we have a
 *     recipient users.id)
 *   - Sending email via Resend when RESEND_API_KEY is configured
 *   - Sending SMS via Twilio when credentials are configured (default text channel)
 *   - Sending WhatsApp via Twilio when credentials are configured (opt-in)
 *   - Logging every delivery attempt to `notification_logs` with a TRUTHFUL
 *     status: 'sent' for real delivery, 'simulated' when no provider key exists,
 *     'failed' on error, 'skipped' when disabled/missing contact.
 */

import 'server-only'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getSiteUrl } from '@/lib/site-url'

export type InAppNotificationType =
  | 'invoice_submitted'
  | 'invoice_approved'
  | 'invoice_rejected'
  | 'invoice_revision_requested'
  | 'invoice_disputed'
  | 'invoice_paid'

type Role = 'admin' | 'accountant' | 'project_manager' | 'contractor'

export interface DispatchRecipient {
  id?: string
  name: string
  email?: string
  phone?: string
  role?: Role
  emailEnabled?: boolean
  /** SMS is the default text channel; defaults to enabled. */
  smsEnabled?: boolean
  /** WhatsApp is kept wired but opt-in; defaults to disabled. */
  whatsAppEnabled?: boolean
}

export interface DispatchContext {
  invoiceId?: string
  contractorId?: string
  projectId?: string
  triggeredBy?: string
}

export interface DispatchArgs {
  /** users.id for the in-app feed; null = external-only recipient (e.g. contractor without portal) */
  recipientUserId: string | null
  recipient: DispatchRecipient
  type: InAppNotificationType
  title: string
  body: string
  link: string
  invoiceId: string
  context: DispatchContext
}

type ChannelStatus = 'sent' | 'simulated' | 'failed' | 'skipped'

export interface DeliveryResult {
  inApp: boolean
  emailStatus: ChannelStatus
  smsStatus: ChannelStatus
  whatsAppStatus: ChannelStatus
}

const RESEND_API_KEY = process.env.RESEND_API_KEY
const RESEND_FROM = process.env.RESEND_FROM_EMAIL || 'notifications@payflow.app'
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886'
// A Twilio SMS-capable sender. Set TWILIO_SMS_FROM to a Twilio phone number
// (E.164, e.g. +14155551234) or a Messaging Service SID (starts with "MG").
const TWILIO_SMS_FROM = process.env.TWILIO_SMS_FROM

/** Role-aware deep link so each recipient lands on a page they can access. */
function resolveLink(role: Role | undefined, invoiceId: string): string {
  if (role === 'contractor') return `/vendor/invoices/${invoiceId}`
  if (role === 'accountant') return `/accountant/invoices/${invoiceId}`
  if (role === 'project_manager') return `/pm/invoices/${invoiceId}`
  return `/invoices/${invoiceId}`
}

async function logDelivery(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  args: DispatchArgs,
  channel: 'email' | 'sms' | 'whatsapp' | 'in_app',
  status: string,
  to?: string
) {
  try {
    await supabase.from('notification_logs').insert({
      event_type: mapEventType(args.type),
      channel,
      recipient_name: args.recipient.name,
      recipient_email: channel === 'email' ? to : args.recipient.email,
      recipient_phone: channel === 'whatsapp' ? to : args.recipient.phone,
      recipient_user_id: args.recipient.role !== 'contractor' ? args.recipientUserId : null,
      recipient_contractor_id:
        args.recipient.role === 'contractor' ? args.context.contractorId ?? args.recipient.id : null,
      recipient_role: args.recipient.role,
      subject: args.title,
      message_preview: args.body?.substring(0, 500),
      invoice_id: args.context.invoiceId,
      project_id: args.context.projectId,
      contractor_id: args.context.contractorId,
      status,
      triggered_by: args.context.triggeredBy,
    })
  } catch (e) {
    console.error('[notify-dispatch] log failed:', e)
  }
}

function mapEventType(type: InAppNotificationType): string {
  // notification_logs.event_type accepts these legacy values
  switch (type) {
    case 'invoice_submitted':
      return 'invoice_submitted'
    case 'invoice_approved':
      return 'invoice_approved'
    case 'invoice_rejected':
      return 'invoice_rejected'
    case 'invoice_paid':
      return 'payment_paid'
    case 'invoice_revision_requested':
    case 'invoice_disputed':
      return 'general'
    default:
      return 'general'
  }
}

async function sendEmail(to: string, subject: string, html: string, text: string) {
  if (!RESEND_API_KEY) {
    console.log('[RESEND EMAIL - SIMULATED]', JSON.stringify({ to, subject }))
    return { status: 'simulated' as const }
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: RESEND_FROM, to, subject, html, text }),
    })
    return { status: res.ok ? ('sent' as const) : ('failed' as const) }
  } catch (e) {
    console.error('[notify-dispatch] email error:', e)
    return { status: 'failed' as const }
  }
}

/** Post a message to the Twilio Messages API. Shared by SMS and WhatsApp. */
async function twilioSend(params: Record<string, string>) {
  const creds = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64')
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  })
  return res.ok
}

/** SMS via Twilio. `to` should be an E.164 number (e.g. +14155551234). */
async function sendSms(to: string, message: string) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_SMS_FROM) {
    console.log('[TWILIO SMS - SIMULATED]', JSON.stringify({ to }))
    return { status: 'simulated' as const }
  }
  try {
    // A Messaging Service SID uses `MessagingServiceSid`; a phone number uses `From`.
    const params: Record<string, string> = { To: to, Body: message }
    if (TWILIO_SMS_FROM.startsWith('MG')) {
      params.MessagingServiceSid = TWILIO_SMS_FROM
    } else {
      params.From = TWILIO_SMS_FROM
    }
    const ok = await twilioSend(params)
    return { status: ok ? ('sent' as const) : ('failed' as const) }
  } catch (e) {
    console.error('[notify-dispatch] sms error:', e)
    return { status: 'failed' as const }
  }
}

async function sendWhatsApp(to: string, message: string) {
  const waTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`
  if (!TWILIO_SID || !TWILIO_TOKEN) {
    console.log('[TWILIO WHATSAPP - SIMULATED]', JSON.stringify({ to: waTo }))
    return { status: 'simulated' as const }
  }
  try {
    const ok = await twilioSend({ From: TWILIO_WHATSAPP_FROM, To: waTo, Body: message })
    return { status: ok ? ('sent' as const) : ('failed' as const) }
  } catch (e) {
    console.error('[notify-dispatch] whatsapp error:', e)
    return { status: 'failed' as const }
  }
}

function buildEmailHtml(title: string, body: string, link: string, ctaLabel = 'View Invoice'): string {
  const url = `${getSiteUrl()}${link}`
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #334155; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 20px;">${title}</h1>
      </div>
      <div style="background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="margin: 0 0 16px;">${body}</p>
        <a href="${url}" style="display: inline-block; background: #334155; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none;">${ctaLabel}</a>
      </div>
      <div style="padding: 16px; text-align: center; color: #64748b; font-size: 12px;">PayFlow AP</div>
    </div>`
}

export interface GenericAlertArgs {
  /** users.id for the in-app feed; null = external-only recipient */
  recipientUserId: string | null
  recipient: DispatchRecipient
  /** stored verbatim in notifications.type (free text column) */
  type: string
  title: string
  body: string
  /** absolute in-app path the recipient can access, e.g. /vendor/compliance */
  link: string
}

/**
 * Deliver a NON-invoice notification (e.g. compliance expiry) across in-app +
 * email + SMS. Unlike `sendNotificationToRecipient`, the link is passed in
 * directly rather than derived from an invoice id. Never throws.
 */
export async function sendGenericAlert(args: GenericAlertArgs): Promise<DeliveryResult> {
  const supabase = getSupabaseAdmin()
  const result: DeliveryResult = {
    inApp: false,
    emailStatus: 'skipped',
    smsStatus: 'skipped',
    whatsAppStatus: 'skipped',
  }

  if (args.recipientUserId) {
    try {
      await supabase.from('notifications').insert({
        recipient_user_id: args.recipientUserId,
        type: args.type,
        title: args.title,
        body: args.body,
        link: args.link,
      })
      result.inApp = true
    } catch (e) {
      console.error('[notify-dispatch] generic in-app insert failed:', e)
    }
  }

  if (args.recipient.email && (args.recipient.emailEnabled ?? true)) {
    const r = await sendEmail(
      args.recipient.email,
      args.title,
      buildEmailHtml(args.title, args.body, args.link, 'View Details'),
      `${args.title}\n\n${args.body}`
    )
    result.emailStatus = r.status
  }

  if (args.recipient.phone && (args.recipient.smsEnabled ?? true)) {
    const r = await sendSms(args.recipient.phone, `${args.title}\n\n${args.body}\n\nReply STOP to opt out.`)
    result.smsStatus = r.status
  }

  return result
}

/**
 * Deliver a single notification across in-app + email + WhatsApp.
 * Never throws — returns the per-channel delivery status.
 */
export async function sendNotificationToRecipient(args: DispatchArgs): Promise<DeliveryResult> {
  const supabase = getSupabaseAdmin()
  const result: DeliveryResult = {
    inApp: false,
    emailStatus: 'skipped',
    smsStatus: 'skipped',
    whatsAppStatus: 'skipped',
  }
  const link = resolveLink(args.recipient.role, args.invoiceId)

  // 1. In-app (only when we have a users.id)
  if (args.recipientUserId) {
    try {
      await supabase.from('notifications').insert({
        recipient_user_id: args.recipientUserId,
        type: args.type,
        title: args.title,
        body: args.body,
        link,
        invoice_id: args.invoiceId,
      })
      result.inApp = true
      await logDelivery(supabase, args, 'in_app', 'sent')
    } catch (e) {
      console.error('[notify-dispatch] in-app insert failed:', e)
    }
  }

  // 2. Email
  if (args.recipient.email && (args.recipient.emailEnabled ?? true)) {
    const r = await sendEmail(
      args.recipient.email,
      args.title,
      buildEmailHtml(args.title, args.body, link),
      `${args.title}\n\n${args.body}`
    )
    result.emailStatus = r.status
    await logDelivery(supabase, args, 'email', r.status, args.recipient.email)
  } else if (!args.recipient.email) {
    await logDelivery(supabase, args, 'email', 'skipped')
  }

  // 3. SMS (default text channel — enabled unless explicitly turned off)
  if (args.recipient.phone && (args.recipient.smsEnabled ?? true)) {
    const r = await sendSms(args.recipient.phone, `${args.title}\n\n${args.body}\n\nReply STOP to opt out.`)
    result.smsStatus = r.status
    await logDelivery(supabase, args, 'sms', r.status, args.recipient.phone)
  }

  // 4. WhatsApp (kept wired but opt-in — disabled unless explicitly enabled)
  if (args.recipient.phone && (args.recipient.whatsAppEnabled ?? false)) {
    const r = await sendWhatsApp(args.recipient.phone, `*${args.title}*\n\n${args.body}`)
    result.whatsAppStatus = r.status
    await logDelivery(supabase, args, 'whatsapp', r.status, args.recipient.phone)
  }

  return result
}
