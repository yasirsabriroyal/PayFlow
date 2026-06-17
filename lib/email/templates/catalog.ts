/**
 * PayFlow email template catalog — the SYSTEM source of truth.
 *
 * Each entry defines the system defaults for a template's tenant-editable text
 * slots (subject, opening, closing, help, notes) plus metadata used by the
 * Communication & Branding Center UI and the live preview.
 *
 * IMPORTANT: only the text slots below are tenant-editable. Required system
 * fields (the payment/invoice details table, audit fields, disclaimer, and the
 * PayFlow footer) are rendered by the email shell and are NOT part of this
 * catalog — they can never be removed by an admin.
 */

export type TemplateKey =
  | 'welcome'
  | 'contractor_invite'
  | 'invoice_submitted'
  | 'invoice_approved'
  | 'invoice_rejected'
  | 'revision_requested'
  | 'payment_confirmation'
  | 'payment_run_confirmation'
  | 'compliance_reminder'
  | 'password_reset'

/** The tenant-editable text slots for a template. */
export interface TemplateSlots {
  subject: string
  opening: string
  closing: string
  help: string
  notes: string
}

export interface MergeField {
  token: string
  description: string
}

export interface TemplatePreviewRow {
  label: string
  value: string
  strong?: boolean
}

/**
 * Audience-specific content overrides for internal-staff notifications.
 * When a recipient is not a contractor, these slots replace the (vendor-facing)
 * `defaults` values so that internal team members receive appropriately worded
 * emails. Only slots that differ from the contractor version need to be listed.
 */
export interface AudienceOverrides {
  opening?: string
  closing?: string
  help?: string
  ctaLabel?: string
}

export interface TemplateDefinition {
  key: TemplateKey
  label: string
  description: string
  /** Grouping for the UI. */
  category: 'Onboarding' | 'Invoices' | 'Payments' | 'Compliance' | 'Account'
  ctaLabel: string
  defaults: TemplateSlots
  /**
   * Internal-audience overrides. Applied when a notification is being sent to
   * an admin, accountant, or project manager instead of the contractor/vendor.
   * Slots not listed here fall through to `defaults`.
   */
  internalDefaults?: AudienceOverrides
  /** Merge tokens this template understands (for the placeholder guide). */
  mergeFields: MergeField[]
  /** Sample data used to render the live preview. */
  preview: {
    greeting: string
    /** System-controlled required fields shown in the preview details table. */
    rows: TemplatePreviewRow[]
  }
}

// Common merge fields available to most transactional emails.
const COMMON_FIELDS: MergeField[] = [
  { token: '{{company_name}}', description: 'Your company / trading name' },
  { token: '{{recipient_name}}', description: 'Name of the email recipient' },
]

const PAYMENT_FIELDS: MergeField[] = [
  { token: '{{vendor_name}}', description: 'Recipient vendor / contractor name' },
  { token: '{{invoice_number}}', description: 'Invoice reference number' },
  { token: '{{project_name}}', description: 'Associated project name' },
  { token: '{{invoice_total}}', description: 'Total invoice amount' },
  { token: '{{payment_amount}}', description: 'Amount paid in this transaction' },
  { token: '{{remaining_balance}}', description: 'Outstanding balance after payment' },
  { token: '{{payment_date}}', description: 'Date the payment was processed' },
  { token: '{{payment_method}}', description: 'Payment method (EFT, cheque, etc.)' },
  { token: '{{payment_reference}}', description: 'Payment / batch reference' },
  { token: '{{payment_status}}', description: 'Payment status' },
  { token: '{{processed_by}}', description: 'Staff member who processed the payment' },
]

export const TEMPLATE_CATALOG: Record<TemplateKey, TemplateDefinition> = {
  welcome: {
    key: 'welcome',
    label: 'Welcome Email',
    description: 'Sent to a new team member when their account is created.',
    category: 'Onboarding',
    ctaLabel: 'Go to Dashboard',
    defaults: {
      subject: 'Welcome to {{company_name}}',
      opening:
        'Welcome aboard! Your {{company_name}} account is ready. You can now sign in to review and manage accounts payable activity.',
      closing: 'We are glad to have you on the team.',
      help: 'If you have any questions getting started, contact us at info@royaldevelopment.ca or +1 403.303.3316.',
      notes: '',
    },
    mergeFields: COMMON_FIELDS,
    preview: { greeting: 'Hi Jordan,', rows: [] },
  },

  contractor_invite: {
    key: 'contractor_invite',
    label: 'Contractor Invite',
    description: 'Invites a contractor/vendor to join the payment portal.',
    category: 'Onboarding',
    ctaLabel: 'Accept Invitation',
    defaults: {
      subject: 'You have been invited to the {{company_name}} Contractor Portal',
      opening:
        'You have been invited to submit invoices and track payments through the {{company_name}} secure contractor portal. Click the button below to set up your account and get started.',
      closing: 'We look forward to working with you.',
      help: 'Need help getting set up? Contact us at info@royaldevelopment.ca or call +1 403.303.3316.',
      notes: '',
    },
    mergeFields: [...COMMON_FIELDS, { token: '{{vendor_name}}', description: 'Invited vendor name' }],
    preview: { greeting: 'Hi Northbridge Mechanical Ltd,', rows: [] },
  },

  invoice_submitted: {
    key: 'invoice_submitted',
    label: 'Invoice Submitted',
    description: 'Notifies reviewers that a new invoice is awaiting approval.',
    category: 'Invoices',
    ctaLabel: 'Review Invoice',
    defaults: {
      subject: 'Invoice {{invoice_number}} submitted for review',
      opening: 'A new invoice has been submitted and is awaiting your review.',
      closing: 'Please review at your earliest convenience.',
      help: 'Questions about this invoice? Reach out to the submitting vendor or your accounts team.',
      notes: '',
    },
    internalDefaults: {
      opening: 'A new invoice from {{vendor_name}} has been submitted and is awaiting your review.',
      closing: 'Please review at your earliest convenience.',
      help: 'Questions about this invoice? Contact the submitting contractor directly.',
      ctaLabel: 'Review Invoice',
    },
    mergeFields: PAYMENT_FIELDS,
    preview: {
      greeting: 'Hi Team,',
      rows: [
        { label: 'Vendor Name', value: 'Northbridge Mechanical Ltd' },
        { label: 'Invoice Number', value: 'INV-2026-0042' },
        { label: 'Project Name', value: 'Riverside Tower - Phase 2' },
        { label: 'Invoice Total', value: '$48,500.00', strong: true },
      ],
    },
  },

  invoice_approved: {
    key: 'invoice_approved',
    label: 'Invoice Approved',
    description: 'Confirms an invoice has been approved for payment.',
    category: 'Invoices',
    ctaLabel: 'View Invoice',
    defaults: {
      subject: 'Invoice {{invoice_number}} approved',
      opening: 'Good news — your invoice has been approved for payment.',
      closing: 'You will receive a confirmation once payment is processed.',
      help: 'Questions about timing? Contact us at info@royaldevelopment.ca or call +1 403.303.3316.',
      notes: '',
    },
    internalDefaults: {
      opening: 'Invoice {{invoice_number}} from {{vendor_name}} has been approved for payment.',
      closing: 'The vendor will be notified separately. Payment will be processed on the next scheduled run.',
      help: 'Questions about payment timing? Contact your accounts payable team.',
      ctaLabel: 'View Invoice',
    },
    mergeFields: PAYMENT_FIELDS,
    preview: {
      greeting: 'Hi Northbridge Mechanical Ltd,',
      rows: [
        { label: 'Invoice Number', value: 'INV-2026-0042' },
        { label: 'Project Name', value: 'Riverside Tower - Phase 2' },
        { label: 'Invoice Total', value: '$48,500.00', strong: true },
        { label: 'Status', value: 'Approved', strong: true },
      ],
    },
  },

  invoice_rejected: {
    key: 'invoice_rejected',
    label: 'Invoice Rejected',
    description: 'Notifies a vendor that their invoice was rejected.',
    category: 'Invoices',
    ctaLabel: 'View Details',
    defaults: {
      subject: 'Invoice {{invoice_number}} was rejected',
      opening: 'Your invoice could not be approved at this time. The reason is included below.',
      closing: 'Please review the details and submit a corrected invoice.',
      help: 'If you believe this is an error, contact us at info@royaldevelopment.ca or call +1 403.303.3316.',
      notes: '',
    },
    internalDefaults: {
      opening: 'Invoice {{invoice_number}} from {{vendor_name}} has been rejected. The reason is included below.',
      closing: 'The vendor has been notified and may resubmit a corrected invoice.',
      help: 'Questions about this rejection? Contact the reviewing approver.',
      ctaLabel: 'View Invoice',
    },
    mergeFields: PAYMENT_FIELDS,
    preview: {
      greeting: 'Hi Northbridge Mechanical Ltd,',
      rows: [
        { label: 'Invoice Number', value: 'INV-2026-0042' },
        { label: 'Invoice Total', value: '$48,500.00' },
        { label: 'Status', value: 'Rejected', strong: true },
      ],
    },
  },

  revision_requested: {
    key: 'revision_requested',
    label: 'Revision Requested',
    description: 'Asks a vendor to revise and resubmit an invoice.',
    category: 'Invoices',
    ctaLabel: 'Revise Invoice',
    defaults: {
      subject: 'Invoice {{invoice_number}} needs revision',
      opening: 'We need a few changes before this invoice can be approved. Details are below.',
      closing: 'Once updated, please resubmit and we will review promptly.',
      help: 'Not sure what to change? Contact us at info@royaldevelopment.ca or call +1 403.303.3316.',
      notes: '',
    },
    internalDefaults: {
      opening: 'A revision has been requested on invoice {{invoice_number}} from {{vendor_name}}. The requested changes are listed below.',
      closing: 'The vendor has been notified and asked to resubmit.',
      help: 'Questions about the requested changes? Contact the reviewing approver.',
      ctaLabel: 'View Invoice',
    },
    mergeFields: PAYMENT_FIELDS,
    preview: {
      greeting: 'Hi Northbridge Mechanical Ltd,',
      rows: [
        { label: 'Invoice Number', value: 'INV-2026-0042' },
        { label: 'Invoice Total', value: '$48,500.00' },
        { label: 'Status', value: 'Revision Requested', strong: true },
      ],
    },
  },

  payment_confirmation: {
    key: 'payment_confirmation',
    label: 'Payment Confirmation',
    description: 'Sent to a vendor when a single invoice payment is processed.',
    category: 'Payments',
    ctaLabel: 'View Payment',
    defaults: {
      subject: 'Payment Confirmation — Invoice {{invoice_number}}',
      opening: 'Your invoice has been paid. A summary of the payment is below for your records.',
      closing: 'Thank you for your work with us.',
      help: 'Questions about this payment? Contact us at info@royaldevelopment.ca or call +1 403.303.3316.',
      notes: '',
    },
    internalDefaults: {
      opening: 'Payment has been processed for invoice {{invoice_number}} from {{vendor_name}}. A summary is below for your records.',
      closing: 'The vendor has been notified of this payment.',
      help: 'Questions about this payment? Contact the processing accountant.',
      ctaLabel: 'View Payment',
    },
    mergeFields: PAYMENT_FIELDS,
    preview: {
      greeting: 'Hi Northbridge Mechanical Ltd,',
      rows: [
        { label: 'Vendor Name', value: 'Northbridge Mechanical Ltd' },
        { label: 'Invoice Number', value: 'INV-2026-0042' },
        { label: 'Project Name', value: 'Riverside Tower - Phase 2' },
        { label: 'Payment Amount', value: '$48,500.00', strong: true },
        { label: 'Remaining Balance', value: '$0.00', strong: true },
        { label: 'Payment Date', value: '2026-06-14' },
        { label: 'Payment Method', value: 'EFT' },
        { label: 'Payment Reference', value: 'EFT-BATCH-001' },
        { label: 'Payment Status', value: 'Paid', strong: true },
        { label: 'Processed By', value: 'Royal Account' },
      ],
    },
  },

  payment_run_confirmation: {
    key: 'payment_run_confirmation',
    label: 'Payment Run Confirmation',
    description: 'Internal summary sent when an EFT/payment batch is executed.',
    category: 'Payments',
    ctaLabel: 'View Payment Run',
    defaults: {
      subject: 'Payment run {{payment_reference}} processed',
      opening: 'A payment run has been executed. A summary of the batch is below.',
      closing: 'Individual vendors have been notified of their payments.',
      help: 'Questions about this batch? Contact the processing accountant.',
      notes: '',
    },
    mergeFields: PAYMENT_FIELDS,
    preview: {
      greeting: 'Hi Team,',
      rows: [
        { label: 'Payment Reference', value: 'EFT-BATCH-001' },
        { label: 'Payment Method', value: 'EFT' },
        { label: 'Invoices Paid', value: '12' },
        { label: 'Batch Total', value: '$214,300.00', strong: true },
        { label: 'Payment Date', value: '2026-06-14' },
        { label: 'Processed By', value: 'Royal Account' },
      ],
    },
  },

  compliance_reminder: {
    key: 'compliance_reminder',
    label: 'Compliance Reminder',
    description: 'Reminds a vendor about expiring compliance documents.',
    category: 'Compliance',
    ctaLabel: 'Update Documents',
    defaults: {
      subject: 'Action needed: compliance documents expiring',
      opening:
        'One or more of your compliance documents are expiring soon. To avoid payment delays, please update them before the expiry date.',
      closing: 'Keeping your documents current ensures uninterrupted payments.',
      help: 'Need help updating a document? Contact us at info@royaldevelopment.ca or call +1 403.303.3316.',
      notes: '',
    },
    mergeFields: [...COMMON_FIELDS, { token: '{{vendor_name}}', description: 'Vendor name' }],
    preview: {
      greeting: 'Hi Northbridge Mechanical Ltd,',
      rows: [
        { label: 'Document', value: 'WSIB Clearance Certificate' },
        { label: 'Expires', value: '2026-06-30', strong: true },
      ],
    },
  },

  password_reset: {
    key: 'password_reset',
    label: 'Password Reset',
    description: 'Sent when a user requests a password reset.',
    category: 'Account',
    ctaLabel: 'Reset Password',
    defaults: {
      subject: 'Reset your {{company_name}} password',
      opening:
        'We received a request to reset your password. Click the button below to choose a new one. This link will expire shortly for your security.',
      closing: 'If you did not request this, you can safely ignore this email.',
      help: 'For security reasons we will never ask for your password by email.',
      notes: '',
    },
    mergeFields: COMMON_FIELDS,
    preview: { greeting: 'Hi Jordan,', rows: [] },
  },
}

export const TEMPLATE_KEYS = Object.keys(TEMPLATE_CATALOG) as TemplateKey[]

export function isTemplateKey(value: string): value is TemplateKey {
  return value in TEMPLATE_CATALOG
}

export function getTemplateDefinition(key: TemplateKey): TemplateDefinition {
  return TEMPLATE_CATALOG[key]
}
