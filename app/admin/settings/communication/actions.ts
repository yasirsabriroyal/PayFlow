'use server'

import { revalidatePath } from 'next/cache'
import { withPermission } from '@/lib/permissions/core'
import { PERMISSIONS } from '@/lib/permissions/constants'
import { getEmailBranding, type EmailBranding } from '@/lib/branding/get-active-branding'
import { renderBrandedEmail } from '@/lib/email/render-email'
import { getSiteUrl } from '@/lib/site-url'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { resolveActiveOrg, resolveActiveOrgId } from '@/lib/tenancy'
import { getOrgEntitlements } from '@/lib/entitlements'
import { resolveInternalUserId } from '@/lib/utils/resolve-user'
import {
  resolveTemplateSlots,
  resolveRenderedTemplate,
  resolveRenderedTemplateForAudience,
  sanitizeSlotText,
  normalizeMergeTokens,
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
      // Offices, disclaimer and social links pass through from saved branding —
      // they are not editable in the branding preview form (managed in Footer Builder).
      offices: saved.offices,
      footerDisclaimer: saved.footerDisclaimer,
      socialLinks: saved.socialLinks,
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

/**
 * Read the active organization's plan, its entitlements, and the current
 * white-label opt-in state. Drives the plan-gated White-Label card in the
 * Branding Center so the toggle reflects the real plan.
 */
export async function getPlanEntitlements() {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async () => {
    const [{ plan, planLabel, entitlements }, org] = await Promise.all([
      getOrgEntitlements(null),
      resolveActiveOrg(null),
    ])
    return {
      success: true as const,
      plan,
      planLabel,
      whiteLabelAllowed: entitlements.whiteLabel,
      // The admin's opt-in toggle (only meaningful when allowed by the plan).
      whiteLabelEnabled: org?.whiteLabelEnabled === true,
    }
  })
}

/**
 * Persist the white-label opt-in on the active organization. Server-side
 * ENFORCED: if the org's plan does not grant white-label, the request is
 * rejected regardless of what the client sends.
 */
export async function setWhiteLabel(enabled: boolean) {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async (userData) => {
    const { entitlements } = await getOrgEntitlements(null)
    if (!entitlements.whiteLabel) {
      return { success: false as const, error: 'White-label is not included in your current plan.' }
    }

    const supabase = getSupabaseAdmin()
    const orgId = await resolveActiveOrgId(null)
    const { error } = await supabase
      .from('organizations')
      .update({ white_label_enabled: enabled, updated_at: new Date().toISOString() })
      .eq('id', orgId)

    if (error) return { success: false as const, error: error.message }

    const internalUserId = await resolveInternalUserId(userData.id, supabase)
    await supabase.from('audit_logs').insert({
      action: 'white_label_updated',
      entity_type: 'organization',
      entity_id: orgId,
      user_id: internalUserId,
      new_values: { white_label_enabled: enabled },
    })

    revalidatePath('/admin/settings/communication')
    return { success: true as const, whiteLabelEnabled: enabled }
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

    // Normalize malformed merge tokens (e.g. `{company_name}}`) to the canonical
    // `{{company_name}}` BEFORE sanitizing/persisting, so a typo can never be
    // saved in a state that ships a raw placeholder to a customer email.
    const clean = {
      subject: sanitizeSlotText(normalizeMergeTokens(slots.subject)),
      opening: sanitizeSlotText(normalizeMergeTokens(slots.opening)),
      closing: sanitizeSlotText(normalizeMergeTokens(slots.closing)),
      help_text: sanitizeSlotText(normalizeMergeTokens(slots.help)),
      notes: sanitizeSlotText(normalizeMergeTokens(slots.notes)),
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

// ─────────────────────────────────────────────────────────────────────────────
// Footer Builder actions
// ─────────────────────────────────────────────────────────────────────────────

export interface OfficeInput {
  id?: string
  officeName: string
  address1?: string
  address2?: string
  city?: string
  province?: string
  postalCode?: string
  country?: string
  phone?: string
  isPrimary?: boolean
  displayOrder?: number
}

export interface FooterSettingsInput {
  footerDisclaimer?: string | null
  socialFacebook?: string | null
  socialLinkedin?: string | null
  socialInstagram?: string | null
  socialTwitter?: string | null
  socialYoutube?: string | null
}

/** Load all company offices for the active org, ordered by display_order. */
export async function getCompanyOffices() {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async () => {
    const supabase = getSupabaseAdmin()
    const orgId = await resolveActiveOrgId(null)
    const { data, error } = await supabase
      .from('company_offices')
      .select('id, office_name, address_1, address_2, city, province, postal_code, country, phone, is_primary, display_order')
      .eq('organization_id', orgId)
      .order('display_order', { ascending: true })
    if (error) return { success: false as const, error: error.message }
    return { success: true as const, offices: data ?? [] }
  })
}

/** Load footer disclaimer + social links from company_settings. */
export async function getFooterSettings() {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async () => {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('company_settings')
      .select('footer_disclaimer, social_facebook, social_linkedin, social_instagram, social_twitter, social_youtube')
      .limit(1)
      .single()
    if (error) return { success: false as const, error: error.message }
    return { success: true as const, settings: data }
  })
}

/** Upsert (create or update) a single office. */
export async function saveOffice(input: OfficeInput) {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async () => {
    const supabase = getSupabaseAdmin()
    const orgId = await resolveActiveOrgId(null)

    // If marking this office as primary, clear the existing primary first.
    if (input.isPrimary) {
      await supabase
        .from('company_offices')
        .update({ is_primary: false })
        .eq('organization_id', orgId)
        .eq('is_primary', true)
    }

    if (input.id) {
      const { error } = await supabase
        .from('company_offices')
        .update({
          office_name: input.officeName,
          address_1: input.address1 ?? null,
          address_2: input.address2 ?? null,
          city: input.city ?? null,
          province: input.province ?? null,
          postal_code: input.postalCode ?? null,
          country: input.country || 'Canada',
          phone: input.phone ?? null,
          is_primary: input.isPrimary ?? false,
          display_order: input.displayOrder ?? 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', input.id)
        .eq('organization_id', orgId)
      if (error) return { success: false as const, error: error.message }
    } else {
      const { error } = await supabase
        .from('company_offices')
        .insert({
          organization_id: orgId,
          office_name: input.officeName,
          address_1: input.address1 ?? null,
          address_2: input.address2 ?? null,
          city: input.city ?? null,
          province: input.province ?? null,
          postal_code: input.postalCode ?? null,
          country: input.country || 'Canada',
          phone: input.phone ?? null,
          is_primary: input.isPrimary ?? false,
          display_order: input.displayOrder ?? 0,
        })
      if (error) return { success: false as const, error: error.message }
    }
    revalidatePath('/admin/settings/communication')
    return { success: true as const }
  })
}

/** Delete an office by id. */
export async function deleteOffice(officeId: string) {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async () => {
    const supabase = getSupabaseAdmin()
    const orgId = await resolveActiveOrgId(null)
    const { error } = await supabase
      .from('company_offices')
      .delete()
      .eq('id', officeId)
      .eq('organization_id', orgId)
    if (error) return { success: false as const, error: error.message }
    revalidatePath('/admin/settings/communication')
    return { success: true as const }
  })
}

/** Save footer disclaimer + social links. */
export async function saveFooterSettings(input: FooterSettingsInput) {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async () => {
    const supabase = getSupabaseAdmin()
    const orgId = await resolveActiveOrgId(null)
    const { error } = await supabase
      .from('company_settings')
      .update({
        footer_disclaimer: input.footerDisclaimer ?? null,
        social_facebook: input.socialFacebook ?? null,
        social_linkedin: input.socialLinkedin ?? null,
        social_instagram: input.socialInstagram ?? null,
        social_twitter: input.socialTwitter ?? null,
        social_youtube: input.socialYoutube ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('organization_id', orgId)
    if (error) return { success: false as const, error: error.message }
    revalidatePath('/admin/settings/communication')
    return { success: true as const }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification Preview Center actions
// ─────────────────────────────────────────────────────────────────────────────

/** Load real projects/contractors/invoices as sample data options for the preview. */
export async function getPreviewSampleData() {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async () => {
    const supabase = getSupabaseAdmin()
    const [projectsRes, contractorsRes, invoicesRes, usersRes] = await Promise.all([
      supabase.from('projects').select('id, name, project_number').eq('is_active', true).order('name').limit(20),
      supabase.from('contractors').select('id, company_name, contact_name, email').order('company_name').limit(20),
      supabase.from('invoices').select('id, invoice_number, total_cents, status, contractor_id, project_id').order('created_at', { ascending: false }).limit(20),
      supabase.from('users').select('id, first_name, last_name, email, role').eq('is_active', true).order('first_name').limit(30),
    ])
    return {
      success: true as const,
      projects: projectsRes.data ?? [],
      contractors: contractorsRes.data ?? [],
      invoices: invoicesRes.data ?? [],
      users: usersRes.data ?? [],
    }
  })
}

/**
 * Render a notification preview for a given event + audience with optional
 * real data. Returns the rendered HTML and the recipient list that the live
 * dispatch engine would produce for the selected invoice.
 */
export async function renderNotificationPreview(
  templateKey: string,
  audience: 'vendor' | 'internal',
  sampleVars?: Record<string, string>,
) {
  return withPermission(PERMISSIONS.ADMINISTRATION.MANAGE_USERS, async () => {
    if (!isTemplateKey(templateKey)) return { success: false as const, error: 'Unknown template key' }
    const key = templateKey as TemplateKey
    const def = getTemplateDefinition(key)

    const vars: Record<string, string | undefined> = {
      company_name: 'Royal Development Group Ltd',
      recipient_name: audience === 'vendor' ? 'Northbridge Mechanical Ltd' : 'Accounts Payable',
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
      ...sampleVars,
    }

    // Map UI audience names to the EmailAudience type used by the resolver.
    const emailAudience = audience === 'vendor' ? 'contractor' : 'internal'
    const rendered = await resolveRenderedTemplateForAudience(key, vars, emailAudience, null)
    const details: EmailDetailRow[] = def.preview.rows.map((r) => ({
      label: r.label,
      value: r.value,
      strong: r.strong,
    }))

    const { html } = await renderBrandedEmail({
      title: rendered.subject || def.label,
      greeting: audience === 'vendor'
        ? `Hi ${vars.vendor_name || 'Contractor'},`
        : `Hi ${vars.recipient_name || 'Team'},`,
      paragraphs: [],
      opening: rendered.opening,
      closing: rendered.closing,
      help: rendered.help,
      notes: rendered.notes,
      details,
      ctaLabel: rendered.ctaLabel || def.ctaLabel,
      ctaUrl: `${getSiteUrl()}/vendor/portal`,
      preview: rendered.subject || def.label,
    })

    return { success: true as const, html, subject: rendered.subject, audience }
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
