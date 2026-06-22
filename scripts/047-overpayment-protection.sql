-- =============================================================================
-- Migration 047: Overpayment Protection
-- =============================================================================
-- Adds database-level idempotency constraints on the payments table and
-- replaces v_invoice_payment_summary with a correct implementation that
-- counts actual payment records from all payment paths.
-- =============================================================================

-- One payment row per certificate (paid once in full)
CREATE UNIQUE INDEX IF NOT EXISTS uix_payments_per_cert
  ON payments (payment_certificate_id)
  WHERE payment_certificate_id IS NOT NULL;

-- One payment row per payment request (prevents double-click duplicates)
CREATE UNIQUE INDEX IF NOT EXISTS uix_payments_per_request
  ON payments (payment_request_id)
  WHERE payment_request_id IS NOT NULL;

-- Drop existing view (column ordering incompatible with CREATE OR REPLACE)
DROP VIEW IF EXISTS v_invoice_payment_summary;

CREATE VIEW v_invoice_payment_summary AS
SELECT
  i.id                          AS invoice_id,
  i.invoice_number,
  i.total_cents                 AS invoice_total_cents,
  i.holdback_cents              AS invoice_holdback_cents,
  i.net_payable_cents           AS invoice_net_payable_cents,
  i.status                      AS invoice_status,
  COALESCE(SUM(pc.certified_amount_cents) FILTER (WHERE pc.status NOT IN ('cancelled','rejected')), 0) AS total_certified_cents,
  COALESCE(SUM(pc.holdback_amount_cents)  FILTER (WHERE pc.status NOT IN ('cancelled','rejected')), 0) AS total_holdback_certified_cents,
  COUNT(pc.id) FILTER (WHERE pc.status NOT IN ('cancelled','rejected'))  AS certificate_count,
  COUNT(pc.id) FILTER (WHERE pc.status = 'paid')                        AS paid_certificate_count,
  COALESCE((
    SELECT SUM(p.amount_cents) FROM payments p
    WHERE p.status NOT IN ('cancelled','returned')
      AND (
        p.payment_certificate_id IN (SELECT id FROM payment_certificates WHERE invoice_id = i.id)
        OR p.payment_request_id  IN (SELECT id FROM payment_requests       WHERE invoice_id = i.id)
      )
  ), 0) AS total_paid_cents,
  i.net_payable_cents - COALESCE((
    SELECT SUM(p.amount_cents) FROM payments p
    WHERE p.status NOT IN ('cancelled','returned')
      AND (
        p.payment_certificate_id IN (SELECT id FROM payment_certificates WHERE invoice_id = i.id)
        OR p.payment_request_id  IN (SELECT id FROM payment_requests       WHERE invoice_id = i.id)
      )
  ), 0) AS remaining_balance_cents
FROM invoices i
LEFT JOIN payment_certificates pc ON pc.invoice_id = i.id
GROUP BY i.id, i.invoice_number, i.total_cents, i.holdback_cents, i.net_payable_cents, i.status;

GRANT SELECT ON v_invoice_payment_summary TO authenticated;
