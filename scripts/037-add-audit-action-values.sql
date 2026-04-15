-- Add missing action values to the audit_action enum
-- The code uses many action values that don't exist in the enum, causing silent insert failures

-- Add all missing action values (each must be committed before the next in PostgreSQL)
-- Using separate statements - these will be committed separately
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'permissions_updated';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'permissions_reset_to_defaults';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment_certificate_created';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment_certificate_submitted';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment_certificate_approved';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment_certificate_rejected';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment_certificate_deleted';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'document_uploaded';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'document_deleted';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'invoice_created';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'report_exported';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'vendor_created';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'vendor_updated';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'vendor_deleted';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'direct_payment_created';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'invoice_approved';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'invoice_rejected';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payments_processed';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'eft_payment_executed';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'holdback_released';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment_recorded';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'direct_invoice_payment';
COMMIT;
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'eft_certificate_batch_executed';
COMMIT;
