-- ============================================================
-- Migration 048 — Certificate Payment Policy Enforcement
-- ============================================================
-- Enforces the "One Certificate = One Payment" accounting rule at the
-- database and application layers.
--
-- Changes:
--   1. contractors.etransfer_email       — required for eTransfer payments
--   2. payment_certificates.paid_at      — immutable timestamp when cert paid
--   3. payment_certificates.paid_by      — immutable actor when cert paid
--   4. audit_action enum additions       — certificate payment lifecycle events

-- 1. Add etransfer_email to contractors
ALTER TABLE contractors
  ADD COLUMN IF NOT EXISTS etransfer_email TEXT;

-- 2. Add paid_at / paid_by to payment_certificates
ALTER TABLE payment_certificates
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES users(id);

-- 3. New audit_action enum values
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'certificate_payment_completed';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'certificate_payment_blocked_duplicate';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'certificate_locked_after_payment';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'certificate_payment_method_selected';

-- 4. Index on etransfer_email for fast lookups
CREATE INDEX IF NOT EXISTS idx_contractors_etransfer_email
  ON contractors(etransfer_email)
  WHERE etransfer_email IS NOT NULL;
