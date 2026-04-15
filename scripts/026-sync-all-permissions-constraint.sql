-- Migration to sync the permission check constraint with ALL permissions from code
-- This ensures the database constraint includes every permission defined in constants.ts

-- Drop and recreate the permission check constraint with the complete list
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
  
  -- Recreate with ALL permissions from constants.ts
  ALTER TABLE role_permissions 
  ADD CONSTRAINT role_permissions_permission_check 
  CHECK (permission IN (
    -- PROJECTS
    'view_projects', 'create_projects', 'edit_projects', 'archive_projects',
    -- PAYMENT_CERTIFICATES
    'create_payment_certificate', 'edit_payment_certificate', 'view_payment_history',
    -- INVOICES
    'view_ap_queue', 'create_invoice', 'upload_invoice_attachment', 'approve_invoices', 'reject_invoices',
    -- PAYMENTS
    'process_payments', 'execute_eft_payments', 'view_payment_records', 'create_direct_payment',
    -- VENDORS
    'view_vendors', 'create_vendors', 'edit_vendors', 'delete_vendors',
    -- CONTRACTS
    'view_contracts', 'upload_contracts', 'edit_contracts',
    -- REPORTING
    'view_financial_reports', 'export_reports',
    -- ADMINISTRATION
    'manage_permissions', 'manage_users', 'manage_roles', 'view_system_logs'
  ));
END $$;

-- Add create_vendors permission to project_manager role
INSERT INTO role_permissions (role, permission) VALUES
  ('project_manager', 'create_vendors')
ON CONFLICT (role, permission) DO NOTHING;

-- Comment for documentation
COMMENT ON CONSTRAINT role_permissions_permission_check ON role_permissions 
IS 'Validates permission values - synced with lib/permissions/constants.ts ALL_PERMISSIONS';
