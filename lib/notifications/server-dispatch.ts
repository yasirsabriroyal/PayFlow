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
import { renderBrandedEmail } from '@/lib/email/render-email'
import type { EmailDetailRow } from '@/emails/notification-email'
import { resolveActiveOrgId } from '@/lib/tenancy'
import { resolveRenderedTemplate } from '@/lib/email/templates/resolve'
import { getEmailBranding } from '@/lib/branding/get-active-branding'

/** Split a notification body into paragraphs for the branded renderer. */
function splitParagraphs(body: string): string[] {
  return body
    .split(/\n{1,}/)
    .map((p) => p.trim())
    .filter(Boolean)
}

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
  /** Tenancy seam: which org this communication belongs to (defaults to the active org). */
  organizationId?: string | null
  /** Links the communication/in-app record to a specific payment. */
  paymentId?: string
  /** Internal recipients copied on this communication, stored for the audit trail. */
  ccRecipients?: Array<{ name: string; email?: string | null; role?: string }>
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
  /** Optional subject line override for the email channel (falls back to title). */
  emailSubject?: string
  /** Tenant-editable content slots resolved from email_templates (Phase 3). */
  emailContent?: {
    opening?: string
    closing?: string
    help?: string
    notes?: string
  }
  /** System-controlled required fields rendered in the email's details table. */
  emailDetails?: EmailDetailRow[]
  /** CTA label override for the email channel. */
  emailCtaLabel?: string
  /** Template key used to render this communication (audit pinning). */
  templateKey?: string | null
  /** Template version used, so historical logs reflect the copy at send time. */
  templateVersion?: number | null
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

interface LogExtras {
  /** Provider message id (e.g. Resend) for webhook correlation. */
  externalMessageId?: string
  /** Provider/SDK error string when status is 'failed'. */
  errorMessage?: string
  /** Why a channel was skipped (preference off, missing contact, etc.). */
  skippedReason?: string
}

async function logDelivery(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  args: DispatchArgs,
  channel: 'email' | 'sms' | 'whatsapp' | 'in_app',
  status: string,
  to?: string,
  extras?: LogExtras
) {
  try {
    const now = new Date().toISOString()
    await supabase.from('notification_logs').insert({
      organization_id: await resolveActiveOrgId(args.context.organizationId),
      event_type: mapEventType(args.type),
      channel,
      recipient_name: args.recipient.name,
      recipient_email: channel === 'email' ? to : args.recipient.email,
      recipient_phone: channel === 'whatsapp' ? to : args.recipient.phone,
      recipient_user_id: args.recipient.role !== 'contractor' ? args.recipientUserId : null,
      recipient_contractor_id:
        args.recipient.role === 'contractor' ? args.context.contractorId ?? args.recipient.id : null,
      recipient_role: args.recipient.role,
      subject: args.emailSubject || args.title,
      message_preview: args.body?.substring(0, 500),
      email_body: channel === 'email' ? args.body : null,
      cc_recipients: args.context.ccRecipients ? args.context.ccRecipients : null,
      invoice_id: args.context.invoiceId,
      project_id: args.context.projectId,
      contractor_id: args.context.contractorId,
      payment_id: args.context.paymentId ?? null,
      template_key: args.templateKey ?? null,
      template_version: args.templateVersion ?? null,
      external_message_id: extras?.externalMessageId ?? null,
      error_message: extras?.errorMessage ?? null,
      skipped_reason: extras?.skippedReason ?? null,
      // Truthful lifecycle timestamps: a real send is timestamped now; delivery
      // confirmation arrives later via provider webhook.
      sent_at: status === 'sent' ? now : null,
      failed_at: status === 'failed' ? now : null,
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
    return { status: 'simulated' as const, id: undefined, error: undefined }
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: RESEND_FROM, to, subject, html, text }),
    })
    const payload = (await res.json().catch(() => null)) as { id?: string; message?: string } | null
    if (res.ok) {
      // Resend returns the provider message id; persist it so delivery webhooks
      // can correlate bounce/delivery/complaint events back to this log row.
      return { status: 'sent' as const, id: payload?.id, error: undefined }
    }
    return { status: 'failed' as const, id: undefined, error: payload?.message || `HTTP ${res.status}` }
  } catch (e) {
    console.error('[notify-dispatch] email error:', e)
    return { status: 'failed' as const, id: undefined, error: e instanceof Error ? e.message : 'send error' }
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
    const { html, text } = await renderBrandedEmail({
      title: args.title,
      greeting: `Hi ${args.recipient.name},`,
      paragraphs: splitParagraphs(args.body),
      ctaLabel: 'View Details',
      ctaUrl: `${getSiteUrl()}${args.link}`,
      preview: args.title,
    })
    const r = await sendEmail(args.recipient.email, args.title, html, text)
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
        project_id: args.context.projectId ?? null,
        payment_id: args.context.paymentId ?? null,
      })
      result.inApp = true
      await logDelivery(supabase, args, 'in_app', 'sent')
    } catch (e) {
      console.error('[notify-dispatch] in-app insert failed:', e)
    }
  }

  // 2. Email
  if (args.recipient.email && (args.recipient.emailEnabled ?? true)) {
    const hasTemplate = !!args.emailContent
    const subject = args.emailSubject || args.title
    const { html, text } = await renderBrandedEmail({
      title: args.title,
      greeting: `Hi ${args.recipient.name},`,
      // When a template is supplied, slots drive the copy; otherwise fall back
      // to the plain body paragraphs (generic alerts).
      paragraphs: hasTemplate ? [] : splitParagraphs(args.body),
      opening: args.emailContent?.opening,
      closing: args.emailContent?.closing,
      help: args.emailContent?.help,
      notes: args.emailContent?.notes,
      details: args.emailDetails,
      ctaLabel: args.emailCtaLabel || 'View Invoice',
      ctaUrl: `${getSiteUrl()}${link}`,
      preview: subject,
    })
    const r = await sendEmail(args.recipient.email, subject, html, text)
    result.emailStatus = r.status
    await logDelivery(supabase, args, 'email', r.status, args.recipient.email, {
      externalMessageId: r.id,
      errorMessage: r.error,
    })
  } else if (!args.recipient.email) {
    await logDelivery(supabase, args, 'email', 'skipped', undefined, {
      skippedReason: 'No email address on file for recipient',
    })
  } else {
    await logDelivery(supabase, args, 'email', 'skipped', args.recipient.email, {
      skippedReason: 'Email channel disabled by recipient preference',
    })
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

export interface ContractorInviteArgs {
  recipient: {
    /** contractors.id — used for the audit trail on notification_logs. */
    contractorId?: string
    /** Display name used in the greeting (contact name, falling back to company). */
    name: string
    email?: string
    phone?: string
  }
  /**
   * The invitee's own company name (the contractor/vendor being invited).
   * This is NEVER used as the inviting company — the inviting company always
   * comes from tenant branding (`getEmailBranding`). Surfaced as `{{vendor_name}}`.
   */
  vendorCompanyName: string
  /** Secure, tokenized acceptance URL. The raw token is never used elsewhere. */
  inviteUrl: string
  /** ISO expiry timestamp, if available. */
  expiresAt?: string
  /** Optional role label shown in the body (defaults to "Vendor / Contractor"). */
  roleLabel?: string
  /** Optional project assignment shown in the details table. */
  projectName?: string
  triggeredBy?: string
  organizationId?: string | null
}

/**
 * Deliver a contractor/vendor portal invitation using the centralized PayFlow
 * branded email standard — the SAME shell, branding, and footer logic as the
 * payment confirmation email. Routes the body through the tenant-editable
 * `contractor_invite` template slots, renders via `renderBrandedEmail`, and
 * logs the delivery to `notification_logs`. Never throws.
 *
 * SECURITY: only the secure invite URL carries the token (no raw token in the
 * body), no internal user/contractor IDs are exposed in the email, and the
 * URL is intentionally not written to logs.
 */
export async function sendContractorInviteEmail(
  args: ContractorInviteArgs
): Promise<{ emailStatus: ChannelStatus; whatsAppStatus: ChannelStatus }> {
  const supabase = getSupabaseAdmin()
  const result = {
    emailStatus: 'skipped' as ChannelStatus,
    whatsAppStatus: 'skipped' as ChannelStatus,
  }

  const orgId = await resolveActiveOrgId(args.organizationId)

  // The inviting company is ALWAYS the tenant (from branding settings) — never
  // the contractor's own company. This is the single source of truth for "who
  // is inviting" and matches the header/logo rendered by the email shell.
  const branding = await getEmailBranding(orgId)
  const invitingCompany = branding.companyName

  const expiryLabel = args.expiresAt
    ? new Date(args.expiresAt).toLocaleDateString('en-CA', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : undefined

  // Resolve tenant-editable copy (org override merged over system defaults).
  // company_name = the inviting tenant; vendor_name = the invited contractor.
  const rendered = await resolveRenderedTemplate('contractor_invite', {
    company_name: invitingCompany,
    recipient_name: args.recipient.name,
    vendor_name: args.vendorCompanyName,
  }, orgId)

  // System-controlled detail rows shown in the invitation (no sensitive data).
  const details: EmailDetailRow[] = [
    { label: 'Invited By', value: invitingCompany, strong: true },
    { label: 'Role', value: args.roleLabel || 'Vendor / Contractor' },
  ]
  if (args.projectName) {
    details.push({ label: 'Project', value: args.projectName })
  }
  if (expiryLabel) {
    details.push({ label: 'Invitation Expires', value: expiryLabel, strong: true })
  }

  const title = `You've been invited to join ${invitingCompany} on PayFlow`
  const subject = rendered.subject || title
  // Explain what PayFlow is used for, alongside the tenant-editable opening.
  const contextLine =
    'PayFlow is the secure workspace used to manage invoices, approvals, payments, and project payment workflows.'

  if (args.recipient.email) {
    const { html, text } = await renderBrandedEmail({
      title,
      greeting: `Hi ${args.recipient.name},`,
      paragraphs: [contextLine],
      opening: rendered.opening,
      closing: rendered.closing,
      help: rendered.help,
      notes: rendered.notes,
      details,
      ctaLabel: 'Accept Invitation',
      ctaUrl: args.inviteUrl,
      preview: subject,
      // Reuse the already-resolved tenant branding so the header, title, and
      // "Invited By" all reflect the SAME inviting company.
      branding,
      orgId,
    })

    const r = await sendEmail(args.recipient.email, subject, html, text)
    result.emailStatus = r.status

    try {
      const now = new Date().toISOString()
      await supabase.from('notification_logs').insert({
        organization_id: orgId,
        event_type: 'general',
        channel: 'email',
        recipient_name: args.recipient.name,
        recipient_email: args.recipient.email,
        recipient_contractor_id: args.recipient.contractorId ?? null,
        recipient_role: 'contractor',
        subject,
        // Never persist the tokenized invite URL — keep the body token-free.
        message_preview: contextLine.substring(0, 500),
        contractor_id: args.recipient.contractorId ?? null,
        template_key: 'contractor_invite',
        template_version: rendered.version,
        external_message_id: r.id ?? null,
        error_message: r.error ?? null,
        sent_at: r.status === 'sent' ? now : null,
        failed_at: r.status === 'failed' ? now : null,
        status: r.status,
        triggered_by: args.triggeredBy ?? null,
      })
    } catch (e) {
      console.error('[notify-dispatch] contractor invite log failed:', e)
    }
  }

  // Optional WhatsApp nudge (text channel) — the secure link only, no token in logs.
  if (args.recipient.phone) {
    const waBody = `*${title}*\n\n${contextLine}\n\nAccept your invitation: ${args.inviteUrl}${
      expiryLabel ? `\n\nExpires ${expiryLabel}.` : ''
    }`
    const r = await sendWhatsApp(args.recipient.phone, waBody)
    result.whatsAppStatus = r.status
  }

  return result
}
