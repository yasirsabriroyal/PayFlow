-- =============================================================================
-- Migration 045: Banking Approval Status
-- Stage 2 — banking hard payment gate
--
-- Changes:
--   1. Add banking_approval_status enum type.
--   2. Add banking_approval_status column to contractors.
--   3. Backfill existing rows:
--        - Contractors with NO encrypted banking data → not_submitted
--        - Contractors WITH encrypted banking data    → pending_review
--      (We never auto-approve existing data. A human must approve.)
--   4. Add non-null constraint + default of 'not_submitted'.
--   5. Add index for fast payment-gate lookups.
--   6. Add audit_action enum values needed by Stage 2 audit logging.
-- =============================================================================

-- ─── 1. Enum type ────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'banking_approval_status'
  ) THEN
    CREATE TYPE banking_approval_status AS ENUM (
      'not_submitted',
      'pending_review',
      'approved',
      'rejected',
      'superseded'
    );
  END IF;
END
$$;

-- ─── 2. Add column (nullable first so backfill can run) ──────────────────────

ALTER TABLE contractors
  ADD COLUMN IF NOT EXISTS banking_approval_status banking_approval_status;

-- ─── 3. Backfill ─────────────────────────────────────────────────────────────

-- Contractors with no encrypted account data → not_submitted
UPDATE contractors
SET banking_approval_status = 'not_submitted'
WHERE banking_approval_status IS NULL
  AND (bank_account_encrypted IS NULL AND bank_account_last4 IS NULL);

-- Contractors with banking data already on file → pending_review
-- (human review required — we never auto-approve existing data)
UPDATE contractors
SET banking_approval_status = 'pending_review'
WHERE banking_approval_status IS NULL
  AND (bank_account_encrypted IS NOT NULL OR bank_account_last4 IS NOT NULL);

-- Safety net: any remaining NULLs (should not exist after above two) → not_submitted
UPDATE contractors
SET banking_approval_status = 'not_submitted'
WHERE banking_approval_status IS NULL;

-- ─── 4. Apply NOT NULL + default ─────────────────────────────────────────────

ALTER TABLE contractors
  ALTER COLUMN banking_approval_status SET NOT NULL,
  ALTER COLUMN banking_approval_status SET DEFAULT 'not_submitted';

-- ─── 5. Index ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_contractors_banking_approval_status
  ON contractors (banking_approval_status);

-- ─── 6. Audit log enum values needed by Stage 2 ──────────────────────────────

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'banking_status_initialized';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'banking_approved';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'banking_rejected';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'banking_payment_blocked';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'banking_status_backfilled';
COMMIT;
