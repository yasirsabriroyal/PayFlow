import 'server-only'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { resolveActiveOrgId, type OrganizationId } from '@/lib/tenancy'
import {
  TEMPLATE_CATALOG,
  type TemplateKey,
  type TemplateSlots,
} from './catalog'

const MAX_SLOT_LENGTH = 1500

/**
 * Sanitize tenant-entered slot text. Content slots are PLAIN TEXT only — any
 * HTML/script is stripped to prevent injection into the rendered email. Length
 * is capped to keep emails sane.
 */
export function sanitizeSlotText(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .replace(/<[^>]*>/g, '') // strip any HTML tags
    .replace(/\u0000/g, '')
    .slice(0, MAX_SLOT_LENGTH)
    .trim()
}

/** Replace known {{tokens}} with values and strip any remaining unresolved tokens. */
export function applyMergeFields(text: string, vars: Record<string, string | undefined>): string {
  if (!text) return ''
  return text
    .replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, token: string) => {
      const v = vars[token.toLowerCase()]
      return v !== undefined && v !== null ? String(v) : ''
    })
    // collapse double spaces left by removed tokens
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/**
 * Resolve the raw (token-containing) slots for a template: org override merged
 * over the system catalog defaults. Optional `overrides` (used by the live
 * preview before saving) take highest precedence.
 */
export async function resolveTemplateSlots(
  key: TemplateKey,
  orgId?: OrganizationId | null,
  overrides?: Partial<TemplateSlots>
): Promise<TemplateSlots> {
  const def = TEMPLATE_CATALOG[key]
  const activeOrg = await resolveActiveOrgId(orgId)

  let stored: Partial<TemplateSlots> = {}
  try {
    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('email_templates')
      .select('subject, opening, closing, help_text, notes')
      .eq('organization_id', activeOrg)
      .eq('template_key', key)
      .eq('is_active', true)
      .maybeSingle()
    if (data) {
      stored = {
        subject: data.subject ?? undefined,
        opening: data.opening ?? undefined,
        closing: data.closing ?? undefined,
        help: data.help_text ?? undefined,
        notes: data.notes ?? undefined,
      }
    }
  } catch (e) {
    console.error('[templates] failed to load override, using defaults:', e)
  }

  // Merge precedence: catalog default < stored override < live override.
  const pick = (slot: keyof TemplateSlots): string => {
    const o = overrides?.[slot]
    if (o !== undefined && o !== null && o !== '') return o
    const s = stored[slot]
    if (s !== undefined && s !== null && s !== '') return s
    return def.defaults[slot]
  }

  return {
    subject: pick('subject'),
    opening: pick('opening'),
    closing: pick('closing'),
    help: pick('help'),
    notes: pick('notes'),
  }
}

export interface RenderedTemplate extends TemplateSlots {}

/**
 * Fully resolve a template for sending/preview: merge slots, substitute merge
 * fields, and sanitize. Returns send-ready plain-text strings.
 */
export async function resolveRenderedTemplate(
  key: TemplateKey,
  vars: Record<string, string | undefined>,
  orgId?: OrganizationId | null,
  overrides?: Partial<TemplateSlots>
): Promise<RenderedTemplate> {
  const slots = await resolveTemplateSlots(key, orgId, overrides)
  return {
    subject: applyMergeFields(sanitizeSlotText(slots.subject), vars),
    opening: applyMergeFields(sanitizeSlotText(slots.opening), vars),
    closing: applyMergeFields(sanitizeSlotText(slots.closing), vars),
    help: applyMergeFields(sanitizeSlotText(slots.help), vars),
    notes: applyMergeFields(sanitizeSlotText(slots.notes), vars),
  }
}
