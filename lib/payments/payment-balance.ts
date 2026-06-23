/**
 * lib/payments/payment-balance.ts
 *
 * Authoritative payment balance helpers — single source of truth for how
 * much has actually been paid on an invoice or certificate.
 *
 * Every payment path MUST call these helpers before creating a new payment
 * record. The denormalised fields on invoices (amount_paid_cents /
 * total_paid_cents) are write-through caches that can fall behind during
 * race conditions. Always query the payments table directly.
 *
 * Excludes payments with status 'cancelled' or 'returned'.
 */

import { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InvoicePaymentBalance {
  /** Net amount ultimately due after holdback */
  netPayableCents: number
  /** Payments linked via payment_certificate_id */
  paidViaCertsCents: number
  /** Payments linked via payment_request_id */
  paidViaRequestsCents: number
  /** Total paid across all paths */
  totalPaidCents: number
  /** Remaining amount (negative when overpaid) */
  remainingPayableCents: number
  /** Amount paid beyond net payable; 0 if not overpaid */
  overpaidCents: number
  /** True when remaining <= 0 */
  isFullyPaid: boolean
}

export interface CertificatePaymentBalance {
  /** Sum of non-cancelled payments for this certificate */
  alreadyPaidCents: number
  /** Amount remaining on the certificate */
  remainingPayableCents: number
  /** True when already paid >= net payable */
  isFullyPaid: boolean
}

// ---------------------------------------------------------------------------
// Invoice balance
// ---------------------------------------------------------------------------

/**
 * Authoritative payment balance for an invoice — sums actual payment records
 * across all payment paths (certificate path + direct/EFT/request path).
 *
 * @param supabase        Admin Supabase client
 * @param invoiceId       Invoice UUID
 * @param netPayableCents Invoice's net_payable_cents (passed in to avoid an
 *                        extra round-trip; caller already has the invoice row)
 */
export async function getInvoicePaymentBalance(
  supabase: SupabaseClient,
  invoiceId: string,
  netPayableCents: number,
): Promise<InvoicePaymentBalance> {
  // 1. Collect certificate IDs for this invoice
  const { data: certs } = await supabase
    .from('payment_certificates')
    .select('id')
    .eq('invoice_id', invoiceId)

  const certIds = (certs ?? []).map((c: { id: string }) => c.id)

  // 2. Collect payment-request IDs for this invoice
  const { data: requests } = await supabase
    .from('payment_requests')
    .select('id')
    .eq('invoice_id', invoiceId)

  const requestIds = (requests ?? []).map((r: { id: string }) => r.id)

  // 3. Sum payments via certificates (if any exist)
  let paidViaCertsCents = 0
  if (certIds.length > 0) {
    const { data: certPayments } = await supabase
      .from('payments')
      .select('amount_cents')
      .in('payment_certificate_id', certIds)
      .not('status', 'in', '(cancelled,returned)')

    paidViaCertsCents = (certPayments ?? []).reduce(
      (sum: number, p: { amount_cents: number }) => sum + (p.amount_cents ?? 0),
      0,
    )
  }

  // 4. Sum payments via payment requests (if any exist)
  let paidViaRequestsCents = 0
  if (requestIds.length > 0) {
    const { data: reqPayments } = await supabase
      .from('payments')
      .select('amount_cents')
      .in('payment_request_id', requestIds)
      .not('status', 'in', '(cancelled,returned)')

    paidViaRequestsCents = (reqPayments ?? []).reduce(
      (sum: number, p: { amount_cents: number }) => sum + (p.amount_cents ?? 0),
      0,
    )
  }

  const totalPaidCents = paidViaCertsCents + paidViaRequestsCents
  const remainingPayableCents = netPayableCents - totalPaidCents
  const overpaidCents = Math.max(0, -remainingPayableCents)

  return {
    netPayableCents,
    paidViaCertsCents,
    paidViaRequestsCents,
    totalPaidCents,
    remainingPayableCents,
    overpaidCents,
    isFullyPaid: remainingPayableCents <= 0,
  }
}

// ---------------------------------------------------------------------------
// Certificate balance
// ---------------------------------------------------------------------------

/**
 * Authoritative payment balance for a single certificate.
 * Sums all non-cancelled/returned payments linked to this certificate ID.
 *
 * @param supabase          Admin Supabase client
 * @param certificateId     Payment certificate UUID
 * @param netPayableCents   Certificate's net_payable_cents
 */
export async function getCertificatePaymentBalance(
  supabase: SupabaseClient,
  certificateId: string,
  netPayableCents: number,
): Promise<CertificatePaymentBalance> {
  const { data: certPayments } = await supabase
    .from('payments')
    .select('amount_cents')
    .eq('payment_certificate_id', certificateId)
    .not('status', 'in', '(cancelled,returned)')

  const alreadyPaidCents = (certPayments ?? []).reduce(
    (sum: number, p: { amount_cents: number }) => sum + (p.amount_cents ?? 0),
    0,
  )

  const remainingPayableCents = netPayableCents - alreadyPaidCents

  return {
    alreadyPaidCents,
    remainingPayableCents,
    isFullyPaid: remainingPayableCents <= 0,
  }
}
