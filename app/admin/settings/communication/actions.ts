'use server'

import { withPermission } from '@/lib/permissions/core'
import { PERMISSIONS } from '@/lib/permissions/constants'
import { getEmailBranding, type EmailBranding } from '@/lib/branding/get-active-branding'
import { renderBrandedEmail } from '@/lib/email/render-email'
import { getSiteUrl } from '@/lib/site-url'

/** Live-editable branding fields surfaced in the Branding Center. */
export interface BrandingPreviewInput {
  companyName?: string
  legalName?: string
  logoUrl?: string | null
  senderDisplayName?: string
  supportContact?: string
  supportEmail?: string
  primaryColor?: string
  accentColor?: string
  whiteLabelEnabled?: boolean
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/**
 * Render a sample payment-confirmation email using the admin's *unsaved*
 * branding edits merged over the currently saved branding. This drives the live
 * preview pane so admins see exactly what vendors will receive before saving.
 *
 * Permission-gated to settings managers; never persists anything.
 */
export async function renderBrandingPreview(input: BrandingPreviewInput) {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async () => {
    // Start from the saved branding so non-editable fields (phone, website,
    // address) are realistic, then overlay the live form edits.
    const saved = await getEmailBranding()

    const branding: EmailBranding = {
      ...saved,
      companyName: input.companyName?.trim() || saved.companyName,
      legalName: input.legalName?.trim() || saved.legalName,
      logoUrl: input.logoUrl ?? saved.logoUrl,
      senderDisplayName: input.senderDisplayName?.trim() || saved.senderDisplayName,
      supportContact: input.supportContact?.trim() || saved.supportContact,
      supportEmail: input.supportEmail?.trim() || saved.supportEmail,
      primaryColor: input.primaryColor && HEX.test(input.primaryColor) ? input.primaryColor : saved.primaryColor,
      accentColor: input.accentColor && HEX.test(input.accentColor) ? input.accentColor : saved.accentColor,
      // White-label is plan-gated (Phase 5); preview honors the requested value
      // so admins can see the effect, but the saved value stays governed elsewhere.
      whiteLabelEnabled: input.whiteLabelEnabled ?? saved.whiteLabelEnabled,
    }

    const { html } = await renderBrandedEmail({
      branding,
      title: 'Payment Confirmation',
      greeting: `Hi ${branding.companyName ? 'Northbridge Mechanical Ltd' : 'Vendor'},`,
      paragraphs: [
        'Your invoice has been paid in full. A summary of the payment is below for your records.',
        'This is a sample preview. Real emails are populated with the actual invoice and payment details.',
      ],
      details: [
        { label: 'Vendor name', value: 'Northbridge Mechanical Ltd' },
        { label: 'Invoice number', value: 'INV-2026-0042' },
        { label: 'Project name', value: 'Riverside Tower - Phase 2' },
        { label: 'Payment amount', value: '$48,500.00' },
        { label: 'Remaining balance', value: '$0.00' },
        { label: 'Payment date', value: new Date().toISOString().split('T')[0] },
        { label: 'Payment method', value: 'EFT' },
        { label: 'Payment reference', value: 'EFT-BATCH-001' },
        { label: 'Payment status', value: 'Paid' },
        { label: 'Processed by', value: 'Accounts Payable' },
      ],
      ctaLabel: 'View Invoice',
      ctaUrl: `${getSiteUrl()}/vendor/portal`,
      preview: 'Payment Confirmation - INV-2026-0042',
    })

    return { success: true as const, html }
  })
}
