-- Migration to add create_direct_payment permission to allowed values
-- This updates the check constraint to include the new permission

-- Drop and recreate the permission check constraint with the new value
DO $$ 
BEGIN
  -- Drop existing constraint if it exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'role_permissions_permission_check'
  ) THEN
    ALTER TABLE role_permissions 
    DROP CONSTRAINT role_permissions_permission_check;
  END IF;
  
  -- Recreate with updated permission list including create_direct_payment
  ALTER TABLE role_permissions 
  ADD CONSTRAINT role_permissions_permission_check 
  CHECK (permission IN (
    'view_projects', 'create_projects', 'edit_projects', 'archive_projects',
    'create_payment_certificate', 'edit_payment_certificate', 'view_payment_history',
    'view_ap_queue', 'upload_invoice_attachment', 'approve_invoices', 'reject_invoices',
    'process_payments', 'execute_eft_payments', 'view_payment_records', 'create_direct_payment',
    'view_vendors', 'create_vendors', 'edit_vendors', 'delete_vendors',
    'view_contracts', 'upload_contracts', 'edit_contracts',
    'view_financial_reports', 'export_reports',
    'manage_permissions', 'manage_users', 'manage_roles', 'view_system_logs'
  ));
END $$;

-- Add comment
COMMENT ON CONSTRAINT role_permissions_permission_check ON role_permissions 
IS 'Validates permission values - updated to include create_direct_payment';
