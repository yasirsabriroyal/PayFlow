/**
 * lib/payments/holdback-engine.ts
 * =============================================================================
 * Stage 3 — Central Holdback Engine
 * =============================================================================
 *
 * Single authoritative place for all holdback ledger creation logic.
 * Previously each payment path had its own inline insert — two of which
 * silently failed every time because holdback_percent (NOT NULL) was omitted,
 * and the EFT batch path had no holdback logic at all.
 *
 * Contract
 * ────────
 *  - Called AFTER the payment record is committed but BEFORE the invoice/cert
 *    status is updated to 'paid'. If holdback creation fails for a required
 *    holdback the caller must surface the error and not advance the status.
 *  - Pure function over a Supabase admin client. Does NOT call revalidatePath.
 *  - Idempotent: if a ledger row already exists for the same invoice_id
 *    (unique per invoice by design) it returns { status: 'skipped' } and
 *    does not insert a duplicate.
 *
 * Stage 3 scope
 * ─────────────
 *  - Create / idempotency-check ledger rows.
 *  - Audit log creation, skip, and failure events.
 *  - Return typed result — no throw, caller decides whether to halt.
 *
 * Out of scope (Stage 4+)
 * ───────────────────────
 *  - Holdback release workflow (already exists in actions.ts, untouched).
 *  - Lien waiver gating.
 *  - QuickBooks journal entries.
 *  - Notification dispatch on holdback creation.
 * =============================================================================
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Caller supplies this for every holdback creation attempt. */
export interface HoldbackInput {
  /** UUID of the invoice this holdback is associated with. */
  invoiceId: string
  /** UUID of the contractor — used as FK on holdback_ledgers. */
  contractorId: string
  /** UUID of the project — used as FK on holdback_ledgers. Required by schema. */
  projectId: string
  /** Holdback amount in cents — the dollar value being withheld. */
  holdbackAmountCents: number
  /**
   * Holdback percentage (0–100).
   * Pass the calculated value; do NOT pass 0 unless truly 0% holdback.
   * Used to populate holdback_percent on the ledger row (NOT NULL column).
   */
  holdbackPercent: number
  /**
   * The date payment was issued. Used as countdown_start_date.
   * ISO date string, e.g. '2026-06-21'.
   */
  paymentDate: string
  /**
   * Statutory holdback release period in days.
   * Defaults to 45 (Builder's Lien Act standard) if not supplied.
   */
  holdbackReleaseDays?: number
  /**
   * Optional: internal users.id of the person who processed the payment.
   * Written to the audit log. May be null for system/batch operations.
   */
  processedByUserId?: string | null
  /**
   * Optional: the payment_request_id if available.
   * Written to holdback_ledgers.payment_request_id for traceability.
   */
  paymentRequestId?: string | null
  /** Optional notes to store on the ledger row. */
  notes?: string | null
}

/** Discriminated union returned by createHoldbackLedger(). */
export type HoldbackResult =
  | {
      status: 'created'
      holdbackId: string
      holdbackAmountCents: number
      releaseDueDate: string
    }
  | {
      status: 'skipped'
      reason: string
      existingHoldbackId: string
    }
  | {
      status: 'not_required'
      reason: string
    }
  | {
      status: 'failed'
      error: string
    }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_HOLDBACK_RELEASE_DAYS = 45

// ---------------------------------------------------------------------------
// Core engine
// ---------------------------------------------------------------------------

/**
 * createHoldbackLedger
 * ────────────────────
 * Creates a holdback_ledgers row for a paid invoice. Safe to call from any
 * payment path. Idempotent on invoice_id.
 *
 * Returns a typed HoldbackResult. The caller must check result.status:
 *   - 'created'      → success, ledger row inserted
 *   - 'skipped'      → already exists, no action needed
 *   - 'not_required' → holdback amount is 0, no ledger needed
 *   - 'failed'       → insert failed; caller should halt status advancement
 */
export async function createHoldbackLedger(
  supabase: SupabaseClient,
  input: HoldbackInput
): Promise<HoldbackResult> {
  const releaseDays = input.holdbackReleaseDays ?? DEFAULT_HOLDBACK_RELEASE_DAYS

  // 1. Not required: skip if holdback amount is zero or negative.
  if (!input.holdbackAmountCents || input.holdbackAmountCents <= 0) {
    return {
      status: 'not_required',
      reason: 'Holdback amount is zero — no ledger entry required.',
    }
  }

  // 2. Idempotency check: one ledger row per invoice, keyed on invoice_id.
  //    Using .maybeSingle() to avoid throwing on no-match.
  const { data: existing, error: lookupError } = await supabase
    .from('holdback_ledgers')
    .select('id, holdback_amount_cents')
    .eq('invoice_id', input.invoiceId)
    .maybeSingle()

  if (lookupError) {
    // Lookup itself failed — treat as a hard failure so the caller can halt.
    await writeAuditFailure(supabase, input, `Holdback idempotency lookup failed: ${lookupError.message}`)
    return {
      status: 'failed',
      error: `Holdback ledger lookup failed: ${lookupError.message}`,
    }
  }

  if (existing) {
    // Already exists — log the skip and return.
    await writeAuditSkip(supabase, input, existing.id)
    return {
      status: 'skipped',
      reason: `Holdback ledger already exists for invoice ${input.invoiceId}.`,
      existingHoldbackId: existing.id,
    }
  }

  // 3. Calculate dates.
  const countdownStart = input.paymentDate
  const releaseDueDate = computeReleaseDueDate(countdownStart, releaseDays)

  // 4. Insert the ledger row.
  const { data: inserted, error: insertError } = await supabase
    .from('holdback_ledgers')
    .insert({
      contractor_id: input.contractorId,
      project_id: input.projectId,
      invoice_id: input.invoiceId,
      payment_request_id: input.paymentRequestId ?? null,
      holdback_amount_cents: input.holdbackAmountCents,
      holdback_percent: input.holdbackPercent,
      status: 'countdown_started',
      countdown_start_date: countdownStart,
      release_due_date: releaseDueDate,
      released_amount_cents: 0,
      notes: input.notes ?? null,
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    const msg = insertError?.message ?? 'Unknown insert error'
    await writeAuditFailure(supabase, input, msg)
    return {
      status: 'failed',
      error: `Holdback ledger creation failed: ${msg}`,
    }
  }

  // 5. Audit log the successful creation.
  await writeAuditCreated(supabase, input, inserted.id, releaseDueDate)

  return {
    status: 'created',
    holdbackId: inserted.id,
    holdbackAmountCents: input.holdbackAmountCents,
    releaseDueDate,
  }
}

// ---------------------------------------------------------------------------
// Batch helper — used by executeEFTPayment
// ---------------------------------------------------------------------------

export interface BatchHoldbackInput {
  invoices: Array<{
    invoiceId: string
    contractorId: string
    projectId: string
    holdbackCents: number
    holdbackPercent: number
    paymentRequestId?: string | null
  }>
  paymentDate: string
  processedByUserId?: string | null
  holdbackReleaseDays?: number
}

export interface BatchHoldbackResult {
  created: number
  skipped: number
  notRequired: number
  failed: Array<{ invoiceId: string; error: string }>
}

/**
 * createHoldbackLedgerBatch
 * ─────────────────────────
 * Runs createHoldbackLedger for each invoice in a batch.
 * Failures are collected and returned — they do NOT halt remaining invoices
 * since the EFT batch has already committed payment records for each invoice
 * individually before this is called.
 *
 * The EFT caller checks result.failed.length > 0 and emits a warning rather
 * than rolling back the entire batch (payment records already exist).
 */
export async function createHoldbackLedgerBatch(
  supabase: SupabaseClient,
  input: BatchHoldbackInput
): Promise<BatchHoldbackResult> {
  const result: BatchHoldbackResult = {
    created: 0,
    skipped: 0,
    notRequired: 0,
    failed: [],
  }

  for (const inv of input.invoices) {
    const r = await createHoldbackLedger(supabase, {
      invoiceId: inv.invoiceId,
      contractorId: inv.contractorId,
      projectId: inv.projectId,
      holdbackAmountCents: inv.holdbackCents,
      holdbackPercent: inv.holdbackPercent,
      paymentDate: input.paymentDate,
      holdbackReleaseDays: input.holdbackReleaseDays,
      processedByUserId: input.processedByUserId ?? null,
      paymentRequestId: inv.paymentRequestId ?? null,
    })

    if (r.status === 'created') result.created++
    else if (r.status === 'skipped') result.skipped++
    else if (r.status === 'not_required') result.notRequired++
    else result.failed.push({ invoiceId: inv.invoiceId, error: r.error })
  }

  return result
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeReleaseDueDate(startDateIso: string, days: number): string {
  const d = new Date(startDateIso)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

async function writeAuditCreated(
  supabase: SupabaseClient,
  input: HoldbackInput,
  holdbackId: string,
  releaseDueDate: string
): Promise<void> {
  await supabase.from('audit_logs').insert({
    action: 'holdback_ledger_created',
    entity_type: 'holdback',
    entity_id: holdbackId,
    user_id: input.processedByUserId ?? null,
    description: `Holdback ledger created for invoice ${input.invoiceId}. Amount: $${(input.holdbackAmountCents / 100).toFixed(2)} (${input.holdbackPercent}%). Release due: ${releaseDueDate}.`,
    new_values: {
      invoice_id: input.invoiceId,
      contractor_id: input.contractorId,
      project_id: input.projectId,
      holdback_amount_cents: input.holdbackAmountCents,
      holdback_percent: input.holdbackPercent,
      countdown_start_date: input.paymentDate,
      release_due_date: releaseDueDate,
    },
  })
}

async function writeAuditSkip(
  supabase: SupabaseClient,
  input: HoldbackInput,
  existingId: string
): Promise<void> {
  await supabase.from('audit_logs').insert({
    action: 'holdback_ledger_skipped',
    entity_type: 'holdback',
    entity_id: existingId,
    user_id: input.processedByUserId ?? null,
    description: `Holdback ledger creation skipped for invoice ${input.invoiceId} — ledger row already exists (id: ${existingId}).`,
    new_values: {
      invoice_id: input.invoiceId,
      existing_holdback_id: existingId,
    },
  })
}

async function writeAuditFailure(
  supabase: SupabaseClient,
  input: HoldbackInput,
  errorMessage: string
): Promise<void> {
  await supabase.from('audit_logs').insert({
    action: 'holdback_ledger_failed',
    entity_type: 'holdback',
    entity_id: input.invoiceId,
    user_id: input.processedByUserId ?? null,
    description: `Holdback ledger creation FAILED for invoice ${input.invoiceId}: ${errorMessage}`,
    new_values: {
      invoice_id: input.invoiceId,
      holdback_amount_cents: input.holdbackAmountCents,
      error: errorMessage,
    },
  })
}
