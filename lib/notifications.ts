/**
 * Notification Engine for PayFlow AP
 * 
 * Handles automated notifications via Email (Resend) and WhatsApp (Twilio)
 * with event-based routing, user preferences, and audit logging.
 * 
 * To activate:
 * 1. Set RESEND_API_KEY in environment variables
 * 2. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM in environment variables
 * 3. Run the 002_notification_system.sql migration
 */

import { createClient } from '@/lib/supabase/client'
import { getSiteUrl } from '@/lib/site-url'

// ============================================
// Configuration
// ============================================

interface NotificationConfig {
  resend: {
    apiKey: string | undefined
    fromEmail: string
  }
  twilio: {
    accountSid: string | undefined
    authToken: string | undefined
    whatsAppFrom: string
  }
  appUrl: string
}

const config: NotificationConfig = {
  resend: {
    apiKey: process.env.RESEND_API_KEY,
    fromEmail: process.env.RESEND_FROM_EMAIL || 'notifications@payflow.app',
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    whatsAppFrom: process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886',
  },
  appUrl: getSiteUrl(),
}

// ============================================
// Types
// ============================================

export type NotificationEventType = 
  | 'invoice_submitted'
  | 'invoice_approved'
  | 'invoice_rejected'
  | 'payment_registered'
  | 'payment_paid'
  | 'payment_failed'
  | 'approval_required'
  | 'holdback_released'
  | 'kyc_verified'
  | 'kyc_rejected'
  | 'wcb_expiring'
  | 'general'

export type NotificationChannel = 'email' | 'whatsapp' | 'sms' | 'push'

export type NotificationStatus = 'pending' | 'sent' | 'delivered' | 'failed' | 'skipped'

export type UserRole = 'admin' | 'accountant' | 'project_manager' | 'contractor'

export interface NotificationRecipient {
  id?: string // user ID or contractor ID
  email?: string
  phone?: string // WhatsApp number in E.164 format (+1234567890)
  name: string
  role?: UserRole
  emailEnabled?: boolean
  whatsAppEnabled?: boolean
}

export interface NotificationContext {
  invoiceId?: string
  paymentRequestId?: string
  projectId?: string
  contractorId?: string
  triggeredBy?: string // user ID who triggered the action
}

export interface InvoiceNotificationData {
  invoiceNumber: string
  amount: number
  projectName: string
  contractorName: string
  submittedDate?: string
}

export interface PaymentNotificationData {
  invoiceNumber: string
  amount: number
  batchId: string
  paymentMethod: 'EFT' | 'Cheque' | 'E-Transfer' | 'Wire Transfer'
  expectedDate?: string
}

export interface ApprovalNotificationData {
  invoiceNumber: string
  amount: number
  projectName: string
  contractorName: string
  budgetImpact?: string
  approverName?: string
}

export interface NotificationResult {
  success: boolean
  emailSent?: boolean
  whatsAppSent?: boolean
  emailLogId?: string
  whatsAppLogId?: string
  error?: string
  skippedReasons?: string[]
}

// ============================================
// Audit Logging
// ============================================

async function logNotification(
  eventType: NotificationEventType,
  channel: NotificationChannel,
  recipient: NotificationRecipient,
  context: NotificationContext,
  status: NotificationStatus,
  subject?: string,
  messagePreview?: string,
  requestPayload?: object,
  skippedReason?: string
): Promise<string | null> {
  try {
    const supabase = createClient()
    
    const { data, error } = await supabase
      .from('notification_logs')
      .insert({
        event_type: eventType,
        channel,
        recipient_name: recipient.name,
        recipient_email: recipient.email,
        recipient_phone: recipient.phone,
        recipient_user_id: recipient.id && recipient.role !== 'contractor' ? recipient.id : null,
        recipient_contractor_id: recipient.id && recipient.role === 'contractor' ? recipient.id : null,
        recipient_role: recipient.role,
        subject,
        message_preview: messagePreview?.substring(0, 500),
        invoice_id: context.invoiceId,
        payment_request_id: context.paymentRequestId,
        project_id: context.projectId,
        contractor_id: context.contractorId,
        status,
        triggered_by: context.triggeredBy,
        request_payload: requestPayload,
        skipped_reason: skippedReason,
        user_preference_checked: true,
        sent_at: status === 'sent' ? new Date().toISOString() : null,
      })
      .select('id')
      .single()
    
    if (error) {
      console.error('[Notification] Failed to log notification:', error)
      return null
    }
    
    return data?.id || null
  } catch (error) {
    console.error('[Notification] Exception logging notification:', error)
    return null
  }
}

async function updateNotificationStatus(
  logId: string,
  status: NotificationStatus,
  externalMessageId?: string,
  errorMessage?: string,
  responsePayload?: object
): Promise<void> {
  try {
    const supabase = createClient()
    
    await supabase
      .from('notification_logs')
      .update({
        status,
        external_message_id: externalMessageId,
        error_message: errorMessage,
        response_payload: responsePayload,
        sent_at: status === 'sent' ? new Date().toISOString() : undefined,
        delivered_at: status === 'delivered' ? new Date().toISOString() : undefined,
        failed_at: status === 'failed' ? new Date().toISOString() : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', logId)
  } catch (error) {
    console.error('[Notification] Failed to update status:', error)
  }
}

// ============================================
// User Preferences
// ============================================

async function getUsersByRole(role: UserRole): Promise<NotificationRecipient[]> {
  try {
    const supabase = createClient()
    
    const { data, error } = await supabase
      .from('users')
      .select('id, email, phone, first_name, last_name, notification_email, notification_phone, email_notifications_enabled, whatsapp_notifications_enabled')
      .eq('role', role)
      .eq('is_active', true)
    
    if (error || !data) {
      console.error('[Notification] Failed to get users by role:', error)
      return []
    }
    
    return data.map(user => ({
      id: user.id,
      email: user.notification_email || user.email,
      phone: user.notification_phone || user.phone,
      name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'User',
      role,
      emailEnabled: user.email_notifications_enabled ?? true,
      whatsAppEnabled: user.whatsapp_notifications_enabled ?? true,
    }))
  } catch (error) {
    console.error('[Notification] Exception getting users:', error)
    return []
  }
}

async function checkUserPreferences(
  userId: string,
  channel: NotificationChannel
): Promise<boolean> {
  try {
    const supabase = createClient()
    
    const { data, error } = await supabase
      .from('users')
      .select('email_notifications_enabled, whatsapp_notifications_enabled')
      .or(`id.eq.${userId},auth_user_id.eq.${userId}`)
      .single()
    
    if (error || !data) {
      return true // Default to enabled if can't check
    }
    
    if (channel === 'email') return data.email_notifications_enabled ?? true
    if (channel === 'whatsapp') return data.whatsapp_notifications_enabled ?? true
    return true
  } catch {
    return true
  }
}

// ============================================
// Email Functions (Resend)
// ============================================

async function sendEmail(
  to: string,
  subject: string,
  htmlContent: string,
  textContent: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const payload = {
    from: config.resend.fromEmail,
    to,
    subject,
    html: htmlContent,
    text: textContent,
  }

  // When no Resend API key is configured, fall back to simulation so that
  // the notification pipeline (logging, status updates) keeps working in
  // development/preview environments without delivering real email.
  if (!config.resend.apiKey) {
    console.log('[RESEND EMAIL - SIMULATED]', JSON.stringify({ to, subject, from: config.resend.fromEmail }, null, 2))
    return { success: true, messageId: `sim_${Date.now()}` }
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.resend.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const data = await response.json()

    if (!response.ok) {
      return { success: false, error: data.message || 'Failed to send email' }
    }

    return { success: true, messageId: data.id }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// ============================================
// WhatsApp Functions (Twilio)
// ============================================

async function sendWhatsApp(
  to: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const whatsAppTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`

  // When Twilio credentials are not configured, fall back to simulation so
  // the rest of the notification pipeline keeps functioning.
  if (!config.twilio.accountSid || !config.twilio.authToken) {
    console.log('[TWILIO WHATSAPP - SIMULATED]', JSON.stringify({ to: whatsAppTo, bodyPreview: message.substring(0, 100) }, null, 2))
    return { success: true, messageId: `sim_wa_${Date.now()}` }
  }

  try {
    const credentials = Buffer.from(
      `${config.twilio.accountSid}:${config.twilio.authToken}`
    ).toString('base64')

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: config.twilio.whatsAppFrom,
          To: whatsAppTo,
          Body: message,
        }),
      }
    )

    const data = await response.json()

    if (!response.ok) {
      return { success: false, error: data.message || 'Failed to send WhatsApp' }
    }

    return { success: true, messageId: data.sid }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// ============================================
// Helper Functions
// ============================================

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(amount)
}

// ============================================
// Email Templates
// ============================================

function getInvoiceSubmittedEmail(recipient: NotificationRecipient, data: InvoiceNotificationData) {
  const subject = `New Invoice Submitted: ${data.invoiceNumber}`
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #334155; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 20px;">New Invoice Requires Review</h1>
      </div>
      <div style="background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="margin: 0 0 16px;">Hi ${recipient.name},</p>
        <p style="margin: 0 0 16px;">A new invoice has been submitted and requires your review:</p>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
          <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Invoice #</td>
              <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; font-weight: bold;">${data.invoiceNumber}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Contractor</td>
              <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${data.contractorName}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Project</td>
              <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${data.projectName}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Amount</td>
              <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #059669;">${formatCurrency(data.amount)}</td></tr>
        </table>
        <a href="${config.appUrl}/accountant/queue" style="display: inline-block; background: #334155; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none;">Review Invoice</a>
      </div>
      <div style="padding: 16px; text-align: center; color: #64748b; font-size: 12px;">PayFlow AP - Enterprise Accounts Payable</div>
    </div>
  `
  
  const text = `New Invoice: ${data.invoiceNumber}\nContractor: ${data.contractorName}\nProject: ${data.projectName}\nAmount: ${formatCurrency(data.amount)}`
  
  const whatsApp = `*PayFlow AP - New Invoice*\n\nInvoice #${data.invoiceNumber} submitted.\n\nContractor: ${data.contractorName}\nProject: ${data.projectName}\nAmount: ${formatCurrency(data.amount)}\n\nPlease review at your earliest convenience.`
  
  return { subject, html, text, whatsApp }
}

function getPaymentRegisteredEmail(recipient: NotificationRecipient, data: InvoiceNotificationData) {
  const subject = `Payment Registered: ${data.invoiceNumber} - ${formatCurrency(data.amount)}`
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1e40af; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 20px;">Payment Registered for Processing</h1>
      </div>
      <div style="background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="margin: 0 0 16px;">Hi ${recipient.name},</p>
        <p style="margin: 0 0 16px;">A payment has been registered and is ready for EFT processing:</p>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
          <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Invoice #</td>
              <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; font-weight: bold;">${data.invoiceNumber}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Contractor</td>
              <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${data.contractorName}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Amount</td>
              <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #059669;">${formatCurrency(data.amount)}</td></tr>
        </table>
        <a href="${config.appUrl}/accountant/payments" style="display: inline-block; background: #1e40af; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none;">View Payment Queue</a>
      </div>
    </div>
  `
  
  const text = `Payment Registered: ${data.invoiceNumber}\nContractor: ${data.contractorName}\nAmount: ${formatCurrency(data.amount)}`
  
  const whatsApp = `*PayFlow AP - Payment Registered*\n\nInvoice #${data.invoiceNumber} is queued for payment.\n\nContractor: ${data.contractorName}\nAmount: ${formatCurrency(data.amount)}`
  
  return { subject, html, text, whatsApp }
}

function getPaymentPaidEmail(recipient: NotificationRecipient, data: PaymentNotificationData) {
  const subject = `Payment Sent: ${formatCurrency(data.amount)} - ${data.invoiceNumber}`
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #059669; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 20px;">Payment Processed</h1>
      </div>
      <div style="background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="margin: 0 0 16px;">Hi ${recipient.name},</p>
        <p style="margin: 0 0 16px;">Great news! Your payment has been processed:</p>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
          <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Invoice #</td>
              <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; font-weight: bold;">${data.invoiceNumber}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Amount</td>
              <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; font-weight: bold; color: #059669;">${formatCurrency(data.amount)}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Payment Method</td>
              <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${data.paymentMethod}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Batch ID</td>
              <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${data.batchId}</td></tr>
          ${data.expectedDate ? `<tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Expected Deposit</td>
              <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${data.expectedDate}</td></tr>` : ''}
        </table>
        <p style="margin: 16px 0 0; color: #64748b; font-size: 14px;">Please allow 1-2 business days for funds to appear.</p>
      </div>
    </div>
  `
  
  const text = `Payment Sent: ${data.invoiceNumber}\nAmount: ${formatCurrency(data.amount)}\nMethod: ${data.paymentMethod}\nBatch: ${data.batchId}`
  
  const whatsApp = `*PayFlow AP - Payment Sent!*\n\nYour payment has been processed.\n\nInvoice #${data.invoiceNumber}\nAmount: ${formatCurrency(data.amount)}\nMethod: ${data.paymentMethod}\n\nFunds should arrive within 1-2 business days.`
  
  return { subject, html, text, whatsApp }
}

// ============================================
// Core Notification Function
// ============================================

async function sendNotification(
  eventType: NotificationEventType,
  recipient: NotificationRecipient,
  context: NotificationContext,
  content: { subject: string; html: string; text: string; whatsApp: string }
): Promise<NotificationResult> {
  const result: NotificationResult = { success: false, skippedReasons: [] }
  
  // Check email preference and send
  if (recipient.email) {
    const emailEnabled = recipient.emailEnabled ?? 
      (recipient.id ? await checkUserPreferences(recipient.id, 'email') : true)
    
    if (emailEnabled) {
      const logId = await logNotification(
        eventType, 'email', recipient, context, 'pending',
        content.subject, content.text, { to: recipient.email }
      )
      
      const emailResult = await sendEmail(recipient.email, content.subject, content.html, content.text)
      result.emailSent = emailResult.success
      result.emailLogId = logId || undefined
      
      if (logId) {
        await updateNotificationStatus(
          logId,
          emailResult.success ? 'sent' : 'failed',
          emailResult.messageId,
          emailResult.error
        )
      }
    } else {
      result.skippedReasons?.push('email_disabled_by_user')
      await logNotification(eventType, 'email', recipient, context, 'skipped', content.subject, content.text, undefined, 'user_disabled_email')
    }
  } else {
    result.skippedReasons?.push('no_email_address')
  }
  
  // Check WhatsApp preference and send
  if (recipient.phone) {
    const whatsAppEnabled = recipient.whatsAppEnabled ?? 
      (recipient.id ? await checkUserPreferences(recipient.id, 'whatsapp') : true)
    
    if (whatsAppEnabled) {
      const logId = await logNotification(
        eventType, 'whatsapp', recipient, context, 'pending',
        content.subject, content.whatsApp, { to: recipient.phone }
      )
      
      const waResult = await sendWhatsApp(recipient.phone, content.whatsApp)
      result.whatsAppSent = waResult.success
      result.whatsAppLogId = logId || undefined
      
      if (logId) {
        await updateNotificationStatus(
          logId,
          waResult.success ? 'sent' : 'failed',
          waResult.messageId,
          waResult.error
        )
      }
    } else {
      result.skippedReasons?.push('whatsapp_disabled_by_user')
      await logNotification(eventType, 'whatsapp', recipient, context, 'skipped', content.subject, content.whatsApp, undefined, 'user_disabled_whatsapp')
    }
  } else {
    result.skippedReasons?.push('no_phone_number')
  }
  
  result.success = (result.emailSent || false) || (result.whatsAppSent || false)
  return result
}

// ============================================
// Event-Based Notification Functions
// ============================================

/**
 * Send notification when a vendor submits a new invoice
 * Routes to: Accountant (by preference)
 */
export async function sendInvoiceSubmittedNotification(
  recipient: NotificationRecipient,
  data: InvoiceNotificationData,
  context?: NotificationContext
): Promise<NotificationResult> {
  const content = getInvoiceSubmittedEmail(recipient, data)
  return sendNotification('invoice_submitted', recipient, context || {}, content)
}

/**
 * Send a contractor portal invitation (email + optional WhatsApp).
 * Contains a tokenized link the contractor uses to set a password and
 * activate their portal login. Uses the 'general' event type so it works
 * regardless of the notification_logs event constraint.
 */
export async function sendContractorInvitationNotification(
  recipient: NotificationRecipient,
  data: { companyName: string; inviteUrl: string; expiresAt?: string },
  context?: NotificationContext
): Promise<NotificationResult> {
  const subject = `You're invited to the PayFlow vendor portal`
  const expiryNote = data.expiresAt
    ? `<p style="margin: 0 0 16px; color: #64748b; font-size: 13px;">This invitation expires on ${new Date(data.expiresAt).toLocaleDateString('en-CA')}.</p>`
    : ''

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #334155; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 20px;">PayFlow Vendor Portal Invitation</h1>
      </div>
      <div style="background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="margin: 0 0 16px;">Hi ${recipient.name},</p>
        <p style="margin: 0 0 16px;">${data.companyName} has been invited to access the PayFlow vendor portal, where you can submit invoices, track payments, and manage compliance documents.</p>
        <p style="margin: 0 0 16px;">Click the button below to set your password and activate your account:</p>
        <a href="${data.inviteUrl}" style="display: inline-block; background: #334155; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none;">Accept Invitation</a>
        ${expiryNote}
        <p style="margin: 16px 0 0; color: #64748b; font-size: 12px; word-break: break-all;">Or paste this link into your browser: ${data.inviteUrl}</p>
      </div>
      <div style="padding: 16px; text-align: center; color: #64748b; font-size: 12px;">PayFlow AP - Enterprise Accounts Payable</div>
    </div>
  `

  const text = `You're invited to the PayFlow vendor portal.\n\nAccept your invitation and set your password:\n${data.inviteUrl}${data.expiresAt ? `\n\nThis invitation expires on ${new Date(data.expiresAt).toLocaleDateString('en-CA')}.` : ''}`

  const whatsApp = `*PayFlow Vendor Portal Invitation*\n\nHi ${recipient.name}, ${data.companyName} has been invited to the PayFlow vendor portal.\n\nActivate your account here:\n${data.inviteUrl}`

  return sendNotification('general', recipient, context || {}, { subject, html, text, whatsApp })
}

/**
 * Notify when payment is registered (staged for processing)
 * Routes to: All Accountants
 */
export async function notifyPaymentRegistered(
  data: InvoiceNotificationData,
  context?: NotificationContext
): Promise<{ total: number; successful: number; failed: number }> {
  const accountants = await getUsersByRole('accountant')
  
  const results = await Promise.all(
    accountants.map(recipient => {
      const content = getPaymentRegisteredEmail(recipient, data)
      return sendNotification('payment_registered', recipient, context || {}, content)
    })
  )
  
  return {
    total: results.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
  }
}

/**
 * Notify when payment is paid (EFT batch generated)
 * Routes to: Contractor AND Admin
 */
export async function notifyPaymentPaid(
  contractor: NotificationRecipient,
  data: PaymentNotificationData,
  context?: NotificationContext
): Promise<{ contractorNotified: NotificationResult; adminResults: NotificationResult[] }> {
  const content = getPaymentPaidEmail(contractor, data)
  
  // Notify contractor
  const contractorResult = await sendNotification('payment_paid', contractor, context || {}, content)
  
  // Notify all admins
  const admins = await getUsersByRole('admin')
  const adminContent = {
    subject: `Payment Processed: ${data.invoiceNumber} to ${contractor.name}`,
    html: `<div style="font-family: Arial, sans-serif;"><h2>Payment Processed</h2><p>Invoice #${data.invoiceNumber}</p><p>Contractor: ${contractor.name}</p><p>Amount: ${formatCurrency(data.amount)}</p><p>Batch: ${data.batchId}</p></div>`,
    text: `Payment processed: ${data.invoiceNumber} to ${contractor.name}, ${formatCurrency(data.amount)}, Batch: ${data.batchId}`,
    whatsApp: `*Payment Processed*\n\nInvoice #${data.invoiceNumber}\nTo: ${contractor.name}\nAmount: ${formatCurrency(data.amount)}\nBatch: ${data.batchId}`,
  }
  
  const adminResults = await Promise.all(
    admins.map(admin => sendNotification('payment_paid', admin, context || {}, adminContent))
  )
  
  return { contractorNotified: contractorResult, adminResults }
}

/**
 * Send PM approval notification
 */
export async function sendPMApprovalNotification(
  recipient: NotificationRecipient,
  data: ApprovalNotificationData,
  context?: NotificationContext
): Promise<NotificationResult> {
  const content = {
    subject: `Approval Required: ${data.invoiceNumber} - ${formatCurrency(data.amount)}`,
    html: `<div style="font-family: Arial, sans-serif;"><h2>Invoice Approval Required</h2><p>Invoice #${data.invoiceNumber}</p><p>Contractor: ${data.contractorName}</p><p>Project: ${data.projectName}</p><p>Amount: ${formatCurrency(data.amount)}</p>${data.budgetImpact ? `<p>Budget Impact: ${data.budgetImpact}</p>` : ''}<a href="${config.appUrl}/pm/approvals">Review & Approve</a></div>`,
    text: `Approval Required: ${data.invoiceNumber}, ${data.contractorName}, ${formatCurrency(data.amount)}`,
    whatsApp: `*Approval Required*\n\nInvoice #${data.invoiceNumber}\nContractor: ${data.contractorName}\nAmount: ${formatCurrency(data.amount)}\n\nPlease review and approve.`,
  }
  
  return sendNotification('approval_required', recipient, context || {}, content)
}

/**
 * Send payment notification to vendor
 */
export async function sendPaymentSentNotification(
  recipient: NotificationRecipient,
  data: PaymentNotificationData,
  context?: NotificationContext
): Promise<NotificationResult> {
  const content = getPaymentPaidEmail(recipient, data)
  return sendNotification('payment_paid', recipient, context || {}, content)
}

/**
 * Batch send payment notifications to multiple vendors
 */
export async function sendBatchPaymentNotifications(
  payments: Array<{
    recipient: NotificationRecipient
    data: PaymentNotificationData
  }>,
  context?: NotificationContext
): Promise<{ total: number; successful: number; failed: number }> {
  const results = await Promise.all(
    payments.map(({ recipient, data }) => sendPaymentSentNotification(recipient, data, context))
  )
  
  return {
    total: results.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
  }
}

// ============================================
// Export utility functions for external use
// ============================================

export { getUsersByRole, checkUserPreferences, formatCurrency }
