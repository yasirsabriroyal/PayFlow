-- Fix audit_action enum by adding missing action values
-- These values are used in the codebase but not in the original enum definition

-- Add missing audit action enum values
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'create_certificate';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'approve_certificate';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'reject_certificate';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'pay_certificate';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'direct_invoice_payment';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'batch_payment';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'record_payment';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'upload_document';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'delete_document';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'update_document';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'verify_contractor';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'update_role';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'update_permissions';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'submit_invoice';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment_processed';

-- Verify the enum values
SELECT enumlabel 
FROM pg_enum 
WHERE enumtypid = 'audit_action'::regtype
ORDER BY enumsortorder;
