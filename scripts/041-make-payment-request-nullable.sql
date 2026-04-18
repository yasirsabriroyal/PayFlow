-- =============================================================================
-- Migration 041: Make payments.payment_request_id nullable
-- =============================================================================
-- Context:
-- Migration 030 added payment_certificate_id to the payments table so that
-- certificate-based payments could be recorded without a payment_request.
-- However, the original payments table was created with
-- payment_request_id UUID NOT NULL. This conflicts with cert payments, which
-- have no linked payment_request.
--
-- This migration drops the NOT NULL constraint so payments can be linked to
-- either a payment_request (legacy flow) or a payment_certificate (new flow).
-- =============================================================================

ALTER TABLE payments
  ALTER COLUMN payment_request_id DROP NOT NULL;
