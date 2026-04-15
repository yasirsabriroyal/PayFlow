-- Extend audit_action enum with additional action types used in the application
-- This fixes the silent failure of audit log inserts

-- Add new enum values for invoice actions
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'invoice_approved';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'invoice_rejected';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'invoice_created';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'invoice_updated';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'invoice_submitted';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'invoice_status_change';

-- Add new enum values for payment actions
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment_created';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment_processed';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment_completed';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'direct_invoice_payment';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'eft_batch_created';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'eft_batch_executed';

-- Add new enum values for payment certificate actions
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment_certificate_created';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment_certificate_approved';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment_certificate_rejected';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment_certificate_paid';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'certificate_payment';

-- Add new enum values for contractor actions
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'contractor_created';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'contractor_updated';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'contractor_kyc_approved';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'contractor_kyc_rejected';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'contractor_suspended';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'contractor_activated';

-- Add new enum values for user/role actions
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'user_created';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'user_updated';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'role_assigned';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'permission_changed';

-- Add new enum values for document actions
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'document_uploaded';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'document_deleted';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'attachment_added';

-- Add new enum values for holdback actions
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'holdback_created';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'holdback_released';

-- Add new enum values for project actions  
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'project_created';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'project_updated';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'project_contractor_added';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'project_contractor_removed';

-- Verify the new enum values
SELECT unnest(enum_range(NULL::audit_action)) AS valid_actions;
