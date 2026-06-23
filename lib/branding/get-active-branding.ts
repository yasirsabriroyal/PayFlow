import 'server-only'
import { cache } from 'react'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { resolveActiveOrg, type OrganizationId } from '@/lib/tenancy'
import { entitlementsForPlan } from '@/lib/entitlements'

/**
 * Minimal branding shape used by app UI / PDF (kept for backwards compatibility).
 */
export interface BrandingConfig {
  company_name: string
  logo_url: string | null
}

/** A single office location row used in multi-location footers. */
export interface CompanyOffice {
  id: string
  officeName: string
  address1: string | null
  address2: string | null
  city: string | null
  province: string | null
  postalCode: string | null
  country: string | null
  phone: string | null
  isPrimary: boolean
  displayOrder: number
}

/** Social media links — all optional. */
export interface SocialLinks {
  facebook: string | null
  linkedin: string | null
  instagram: string | null
  twitter: string | null
  youtube: string | null
}

/**
 * Full branding configuration consumed by the email rendering layer.
 *
 * This is the SINGLE abstraction for "who is this communication branded as".
 * Today it reads the single global `company_settings` row. When PayFlow goes
 * multi-tenant, ONLY this resolver changes (to look up per-organization
 * branding by org id) — every email/template consumer stays the same.
 */
export interface EmailBranding {
  /** Display/trading name shown in the email header. */
  companyName: string
  /** Optional registered legal name for disclaimer/footer lines. */
  legalName: string | null
  logoUrl: string | null
  /** Tenant contact details (fall back to nulls when unset). */
  supportEmail: string | null
  /** Named support/contact person shown in the help section. */
  supportContact: string | null
  /** Email sender display name (the "From" label). */
  senderDisplayName: string | null
  phone: string | null
  website: string | null
  /** Single-address fallback (used when no offices are configured). */
  address: string | null
  /** Multi-location offices — ordered by display_order. */
  offices: CompanyOffice[]
  /** Optional legal/confidentiality disclaimer rendered at the bottom of every email footer. */
  footerDisclaimer: string | null
  /** Optional social media links rendered in the footer. */
  socialLinks: SocialLinks
  /** Brand palette. Defaults to the PayFlow slate until tenants can edit colors (Phase 2). */
  primaryColor: string
  accentColor: string
  /**
   * When false (default / no plan entitlement), the "Powered by PayFlow" footer
   * is always rendered. White-label removal is gated to a future plan model.
   */
  whiteLabelEnabled: boolean
}

/** PayFlow default palette — used until per-tenant brand colors exist (Phase 2). */
const DEFAULT_PRIMARY = '#334155'
const DEFAULT_ACCENT = '#059669'
const DEFAULT_COMPANY = 'PayFlow AP'

/**
 * Safely fetches the active branding configuration (logo and name) from the company_settings table.
 * Uses the Service Role client to bypass the internal-user RLS requirement,
 * and extracts strictly the branding fields to prevent leaking sensitive settings.
 * Wrapped in React cache to deduplicate during the server render pass.
 */
export const getActiveBranding = cache(async (): Promise<BrandingConfig> => {
  try {
    const supabaseAdmin = getSupabaseAdmin()

    const { data, error } = await supabaseAdmin
      .from('company_settings')
      .select('company_name, logo_url')
      .limit(1)
      .single()

    if (error || !data) {
      return { company_name: DEFAULT_COMPANY, logo_url: null }
    }

    return {
      company_name: data.company_name || DEFAULT_COMPANY,
      logo_url: data.logo_url,
    }
  } catch {
    // Credentials not available at dev startup — return safe defaults
    return { company_name: DEFAULT_COMPANY, logo_url: null }
  }
})

/**
 * Full email branding resolver. Reads every brand/contact field that exists on
 * `company_settings` today and supplies safe defaults for fields that don't yet
 * have columns (colors, legal name, white-label). Never throws.
 *
 * NOTE: server-only and React-cached so multiple emails in one request share one read.
 */
export const getEmailBranding = cache(async (orgId?: OrganizationId | null): Promise<EmailBranding> => {
  // Resolve through the tenancy seam. Single-tenant today (one global
  // company_settings row); when multi-tenant lands this becomes a
  // `.eq('organization_id', activeOrg.id)` lookup and nothing else changes.
  // White-label removal is a plan entitlement, so it is sourced from the
  // organization record (Phase 5 home) rather than company_settings.
  const activeOrg = await resolveActiveOrg(orgId)
  // Effective white-label requires BOTH a plan that grants it AND the admin
  // having opted in (the org-level toggle). The plan entitlement is the gate.
  const planGrantsWhiteLabel = entitlementsForPlan(activeOrg?.plan).whiteLabel
  const effectiveWhiteLabel = planGrantsWhiteLabel && activeOrg?.whiteLabelEnabled === true
  const supabaseAdmin = getSupabaseAdmin()

  const [settingsResult, officesResult] = await Promise.all([
    supabaseAdmin
      .from('company_settings')
      .select(
        'company_name, legal_name, logo_url, email, phone, website, address, city, province, postal_code, primary_color, accent_color, support_contact, sender_display_name, footer_disclaimer, social_facebook, social_linkedin, social_instagram, social_twitter, social_youtube'
      )
      .limit(1)
      .single(),
    supabaseAdmin
      .from('company_offices')
      .select('id, office_name, address_1, address_2, city, province, postal_code, country, phone, is_primary, display_order')
      .order('display_order', { ascending: true }),
  ])

  const data = settingsResult.data
  const officesData = officesResult.data ?? []

  const offices: CompanyOffice[] = officesData.map((o) => ({
    id: o.id,
    officeName: o.office_name,
    address1: o.address_1 ?? null,
    address2: o.address_2 ?? null,
    city: o.city ?? null,
    province: o.province ?? null,
    postalCode: o.postal_code ?? null,
    country: o.country ?? null,
    phone: o.phone ?? null,
    isPrimary: o.is_primary ?? false,
    displayOrder: o.display_order ?? 0,
  }))

  if (settingsResult.error || !data) {
    return {
      companyName: DEFAULT_COMPANY,
      legalName: null,
      logoUrl: null,
      supportEmail: null,
      supportContact: null,
      senderDisplayName: null,
      phone: null,
      website: null,
      address: null,
      offices,
      footerDisclaimer: null,
      socialLinks: { facebook: null, linkedin: null, instagram: null, twitter: null, youtube: null },
      primaryColor: DEFAULT_PRIMARY,
      accentColor: DEFAULT_ACCENT,
      whiteLabelEnabled: effectiveWhiteLabel,
    }
  }

  const addressParts = [data.address, data.city, data.province, data.postal_code].filter(Boolean)

  return {
    companyName: data.company_name || DEFAULT_COMPANY,
    legalName: data.legal_name ?? null,
    logoUrl: data.logo_url ?? null,
    supportEmail: data.email ?? null,
    supportContact: data.support_contact ?? null,
    senderDisplayName: data.sender_display_name ?? null,
    phone: data.phone ?? null,
    website: data.website ?? null,
    address: addressParts.length ? addressParts.join(', ') : null,
    offices,
    footerDisclaimer: data.footer_disclaimer ?? null,
    socialLinks: {
      facebook: data.social_facebook ?? null,
      linkedin: data.social_linkedin ?? null,
      instagram: data.social_instagram ?? null,
      twitter: data.social_twitter ?? null,
      youtube: data.social_youtube ?? null,
    },
    primaryColor: isValidHex(data.primary_color) ? data.primary_color! : DEFAULT_PRIMARY,
    accentColor: isValidHex(data.accent_color) ? data.accent_color! : DEFAULT_ACCENT,
    // Plan entitlement is the authoritative gate: white-label only takes effect
    // when the org's plan grants it AND the admin opted in. The company_settings
    // flag is no longer consulted — the org record is the single source of truth.
    whiteLabelEnabled: effectiveWhiteLabel,
  }
})

/** Accepts #RGB or #RRGGBB; everything else falls back to the PayFlow default. */
function isValidHex(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())
}
