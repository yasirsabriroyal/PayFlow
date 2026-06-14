'use server'

import { revalidatePath } from 'next/cache'
import { withPermission } from '@/lib/permissions/core'
import { PERMISSIONS } from '@/lib/permissions/constants'
import { getEmailBranding, type EmailBranding } from '@/lib/branding/get-active-branding'
import { renderBrandedEmail } from '@/lib/email/render-email'
import { getSiteUrl } from '@/lib/site-url'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { resolveActiveOrgId } from '@/lib/tenancy'
import { resolveInternalUserId } from '@/lib/utils/resolve-user'
import {
  resolveTemplateSlots,
  resolveRenderedTemplate,
  sanitizeSlotText,
} from '@/lib/email/templates/resolve'
import {
  getTemplateDefinition,
  isTemplateKey,
  type TemplateKey,
  type TemplateSlots,
} from '@/lib/email/templates/catalog'
import type { EmailDetailRow } from '@/emails/notification-email'

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

/** Sample merge-field values used to populate template previews realistically. */
function sampleVarsFor(): Record<string, string | undefined> {
  return {
    company_name: 'Royal Development Group Ltd',
    recipient_name: 'Northbridge Mechanical Ltd',
    vendor_name: 'Northbridge Mechanical Ltd',
    invoice_number: 'INV-2026-0042',
    project_name: 'Riverside Tower - Phase 2',
    invoice_total: '$48,500.00',
    payment_amount: '$48,500.00',
    remaining_balance: '$0.00',
    payment_date: new Date().toISOString().split('T')[0],
    payment_method: 'EFT',
    payment_reference: 'EFT-BATCH-001',
    payment_status: 'Paid',
    processed_by: 'Accounts Payable',
  }
}

/**
 * Load the editable slots for a template: the org's saved override merged over
 * the system catalog defaults (RAW, token-containing text for editing). Also
 * returns catalog metadata for the editor UI.
 */
export async function getTemplateForEditing(rawKey: string) {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async () => {
    if (!isTemplateKey(rawKey)) return { success: false as const, error: 'Unknown template' }
    const key = rawKey as TemplateKey
    const slots = await resolveTemplateSlots(key)
    const def = getTemplateDefinition(key)
    return {
      success: true as const,
      slots,
      defaults: def.defaults,
      mergeFields: def.mergeFields,
      label: def.label,
      description: def.description,
    }
  })
}

/**
 * Render a live preview of a template using the admin's *unsaved* slot edits,
 * merged over saved override + catalog defaults, with sample data + real
 * branding. Never persists anything.
 */
export async function renderTemplatePreview(rawKey: string, overrides: Partial<TemplateSlots>) {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async () => {
    if (!isTemplateKey(rawKey)) return { success: false as const, error: 'Unknown template' }
    const key = rawKey as TemplateKey
    const def = getTemplateDefinition(key)
    const vars = sampleVarsFor()
    const rendered = await resolveRenderedTemplate(key, vars, null, overrides)
    const details: EmailDetailRow[] = def.preview.rows.map((r) => ({
      label: r.label,
      value: r.value,
      strong: r.strong,
    }))

    const { html } = await renderBrandedEmail({
      title: rendered.subject || def.label,
      greeting: def.preview.greeting,
      paragraphs: [],
      opening: rendered.opening,
      closing: rendered.closing,
      help: rendered.help,
      notes: rendered.notes,
      details,
      ctaLabel: def.ctaLabel,
      ctaUrl: `${getSiteUrl()}/vendor/portal`,
      preview: rendered.subject || def.label,
    })

    return { success: true as const, html, subject: rendered.subject }
  })
}

/** Persist a template's editable slots for the active organization. */
export async function saveTemplate(rawKey: string, slots: Partial<TemplateSlots>) {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async (userData) => {
    if (!isTemplateKey(rawKey)) return { success: false as const, error: 'Unknown template' }
    const key = rawKey as TemplateKey
    const supabase = getSupabaseAdmin()
    const orgId = await resolveActiveOrgId(null)
    const updatedBy = await resolveInternalUserId(userData.id, supabase)

    const clean = {
      subject: sanitizeSlotText(slots.subject),
      opening: sanitizeSlotText(slots.opening),
      closing: sanitizeSlotText(slots.closing),
      help_text: sanitizeSlotText(slots.help),
      notes: sanitizeSlotText(slots.notes),
    }

    const { error } = await supabase
      .from('email_templates')
      .upsert(
        {
          organization_id: orgId,
          template_key: key,
          ...clean,
          is_active: true,
          updated_by: updatedBy,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id,template_key' }
      )

    if (error) return { success: false as const, error: error.message }
    revalidatePath('/admin/settings/communication')
    return { success: true as const }
  })
}

/** Revert a template to system defaults by removing the org override. */
export async function resetTemplate(rawKey: string) {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async () => {
    if (!isTemplateKey(rawKey)) return { success: false as const, error: 'Unknown template' }
    const key = rawKey as TemplateKey
    const supabase = getSupabaseAdmin()
    const orgId = await resolveActiveOrgId(null)
    const { error } = await supabase
      .from('email_templates')
      .delete()
      .eq('organization_id', orgId)
      .eq('template_key', key)
    if (error) return { success: false as const, error: error.message }
    revalidatePath('/admin/settings/communication')
    return { success: true as const }
  })
}
