import 'server-only'
import { cache } from 'react'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { resolveActiveOrgId } from '@/lib/tenancy'

/**
 * Tenant-editable content slots for a transactional email. These wrap the
 * SYSTEM-CONTROLLED required-field blocks (payment details, status, audit info)
 * which are always code-rendered and can never be removed by editing a template.
 */
export interface TemplateContent {
  templateKey: string
  /** The version actually applied (org override version, or 0 for system default). */
  version: number
  openingText: string | null
  closingText: string | null
  helpText: string | null
  notesText: string | null
}

export type TemplateKey = 'payment_confirmation' | 'payment_run_confirmation'

const EMPTY: Omit<TemplateContent, 'templateKey'> = {
  version: 0,
  openingText: null,
  closingText: null,
  helpText: null,
  notesText: null,
}

/**
 * Resolve the effective content slots for a template:
 *   org-active override  →  system default  →  empty
 *
 * Required system blocks are NOT sourced here; they are rendered in code from
 * the enriched payment payload, so a missing/incomplete template can never drop
 * a required field.
 */
export const resolveTemplateContent = cache(
  async (templateKey: TemplateKey, orgId?: string | null): Promise<TemplateContent> => {
    const supabase = getSupabaseAdmin()
    const organizationId = await resolveActiveOrgId(orgId)

    // System default first (also the fallback for every slot).
    const { data: def } = await supabase
      .from('email_template_defaults')
      .select('opening_text, closing_text, help_text, notes_text')
      .eq('template_key', templateKey)
      .maybeSingle()

    // Active org override, if any.
    const { data: override } = await supabase
      .from('email_templates')
      .select('opening_text, closing_text, help_text, notes_text, version, is_active')
      .eq('organization_id', organizationId)
      .eq('template_key', templateKey)
      .eq('is_active', true)
      .maybeSingle()

    // Per-slot fallback so a partially filled override still shows system copy.
    const pick = (o: string | null | undefined, d: string | null | undefined) =>
      o != null && o.trim() !== '' ? o : d ?? null

    if (!def && !override) {
      return { templateKey, ...EMPTY }
    }

    return {
      templateKey,
      version: override?.version ?? 0,
      openingText: pick(override?.opening_text, def?.opening_text),
      closingText: pick(override?.closing_text, def?.closing_text),
      helpText: pick(override?.help_text, def?.help_text),
      notesText: pick(override?.notes_text, def?.notes_text),
    }
  }
)
