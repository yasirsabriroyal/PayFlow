import 'server-only'
import { cache } from 'react'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

export interface BrandingConfig {
  company_name: string
  logo_url: string | null
}

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
      company_name: 'PayFlow AP',
      logo_url: null
    }
  }

  return {
    company_name: data.company_name || 'PayFlow AP',
    logo_url: data.logo_url
  }
})
