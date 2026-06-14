import 'server-only'
import { cache } from 'react'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/**
 * Minimal branding shape used by app UI / PDF (kept for backwards compatibility).
 */
export interface BrandingConfig {
  company_name: string
  logo_url: string | null
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
  phone: string | null
  website: string | null
  address: string | null
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
  const supabaseAdmin = getSupabaseAdmin()

  const { data, error } = await supabaseAdmin
    .from('company_settings')
    .select('company_name, logo_url')
    .limit(1)
    .single()

  if (error || !data) {
    // Fallback if settings don't exist yet
    return {
      company_name: DEFAULT_COMPANY,
      logo_url: null,
    }
  }

  return {
    company_name: data.company_name || DEFAULT_COMPANY,
    logo_url: data.logo_url,
  }
})

/**
 * Full email branding resolver. Reads every brand/contact field that exists on
 * `company_settings` today and supplies safe defaults for fields that don't yet
 * have columns (colors, legal name, white-label). Never throws.
 *
 * NOTE: server-only and React-cached so multiple emails in one request share one read.
 */
export const getEmailBranding = cache(async (): Promise<EmailBranding> => {
  const supabaseAdmin = getSupabaseAdmin()

  const { data, error } = await supabaseAdmin
    .from('company_settings')
    .select('company_name, logo_url, email, phone, website, address, city, province, postal_code')
    .limit(1)
    .single()

  if (error || !data) {
    return {
      companyName: DEFAULT_COMPANY,
      legalName: null,
      logoUrl: null,
      supportEmail: null,
      phone: null,
      website: null,
      address: null,
      primaryColor: DEFAULT_PRIMARY,
      accentColor: DEFAULT_ACCENT,
      whiteLabelEnabled: false,
    }
  }

  const addressParts = [data.address, data.city, data.province, data.postal_code].filter(Boolean)

  return {
    companyName: data.company_name || DEFAULT_COMPANY,
    legalName: null,
    logoUrl: data.logo_url ?? null,
    supportEmail: data.email ?? null,
    phone: data.phone ?? null,
    website: data.website ?? null,
    address: addressParts.length ? addressParts.join(', ') : null,
    primaryColor: DEFAULT_PRIMARY,
    accentColor: DEFAULT_ACCENT,
    whiteLabelEnabled: false,
  }
})
