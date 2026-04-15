-- Migration to add create_invoice permission to allowed values
-- The permission was defined in code but missing from the database constraint

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
  
  -- Recreate with updated permission list including create_invoice
  ALTER TABLE role_permissions 
  ADD CONSTRAINT role_permissions_permission_check 
  CHECK (permission IN (
    'view_projects', 'create_projects', 'edit_projects', 'archive_projects',
    'create_payment_certificate', 'edit_payment_certificate', 'view_payment_history',
    'view_ap_queue', 'create_invoice', 'upload_invoice_attachment', 'approve_invoices', 'reject_invoices',
    'process_payments', 'execute_eft_payments', 'view_payment_records', 'create_direct_payment',
    'view_vendors', 'create_vendors', 'edit_vendors', 'delete_vendors',
    'view_contracts', 'upload_contracts', 'edit_contracts',
    'view_financial_reports', 'export_reports',
    'manage_permissions', 'manage_users', 'manage_roles', 'view_system_logs'
  ));
END $$;

-- Add the create_invoice permission to project_manager role (they should have it by default)
INSERT INTO role_permissions (role, permission) VALUES
  ('project_manager', 'create_invoice')
ON CONFLICT (role, permission) DO NOTHING;

-- Add comment
COMMENT ON CONSTRAINT role_permissions_permission_check ON role_permissions 
IS 'Validates permission values - updated to include create_invoice';
