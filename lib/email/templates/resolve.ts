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

/**
 * Repair malformed merge tokens so a single-brace typo can never ship a raw,
 * unresolved placeholder into a customer email. Normalizes any of `{token}`,
 * `{token}}`, or `{{token}` into the canonical `{{token}}` form. Only word-like
 * tokens (letters/digits/underscore) are touched, so ordinary prose with braces
 * is left alone in practice for our template copy.
 *
 * Root cause this guards against: a saved subject like
 * "You Are Invited to Join {company_name}} on PayFLow" — a single opening brace
 * the `{{…}}`-only substitution engine could not match.
 */
export function normalizeMergeTokens(text: string | null | undefined): string {
  if (!text) return ''
  return (
    text
      // Collapse 1-or-2 braces on each side down to exactly two around a token.
      .replace(/\{{1,2}\s*([a-z0-9_]+)\s*\}{1,2}/gi, '{{$1}}')
  )
}

/** True when the text still contains a malformed (non-`{{…}}`) brace token. */
export function hasMalformedMergeTokens(text: string | null | undefined): boolean {
  if (!text) return false
  return normalizeMergeTokens(text) !== text
}

/** Replace known {{tokens}} with values and strip any remaining unresolved tokens. */
export function applyMergeFields(text: string, vars: Record<string, string | undefined>): string {
  if (!text) return ''
  // Defensive: repair malformed braces before substitution so a stored typo
  // never leaks a literal placeholder into a sent email.
  return normalizeMergeTokens(text)
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

export interface RenderedTemplate extends TemplateSlots {
  /** Version of the org override used (0 = system catalog default, no override). */
  version: number
}

/** Look up the active override version for a template (0 when none exists). */
export async function getTemplateVersion(key: TemplateKey, orgId?: OrganizationId | null): Promise<number> {
  try {
    const supabase = getSupabaseAdmin()
    const activeOrg = await resolveActiveOrgId(orgId)
    const { data } = await supabase
      .from('email_templates')
      .select('version')
      .eq('organization_id', activeOrg)
      .eq('template_key', key)
      .eq('is_active', true)
      .maybeSingle()
    return typeof data?.version === 'number' ? data.version : 0
  } catch {
    return 0
  }
}

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
  const version = await getTemplateVersion(key, orgId)
  return {
    subject: applyMergeFields(sanitizeSlotText(slots.subject), vars),
    opening: applyMergeFields(sanitizeSlotText(slots.opening), vars),
    closing: applyMergeFields(sanitizeSlotText(slots.closing), vars),
    help: applyMergeFields(sanitizeSlotText(slots.help), vars),
    notes: applyMergeFields(sanitizeSlotText(slots.notes), vars),
    version,
  }
}
