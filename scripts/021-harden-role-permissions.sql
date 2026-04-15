-- Hardening migration for role_permissions table
-- Ensures proper constraints and indexes

-- Add check constraint for valid roles (if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'role_permissions_role_check'
  ) THEN
    ALTER TABLE role_permissions 
    ADD CONSTRAINT role_permissions_role_check 
    CHECK (role IN ('admin', 'project_manager', 'accountant', 'contractor'));
  END IF;
END $$;

-- Add check constraint for valid permissions
-- This ensures only known permission keys can be inserted
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'role_permissions_permission_check'
  ) THEN
    ALTER TABLE role_permissions 
    ADD CONSTRAINT role_permissions_permission_check 
    CHECK (permission IN (
      'view_projects', 'create_projects', 'edit_projects', 'archive_projects',
      'create_payment_certificate', 'edit_payment_certificate', 'view_payment_history',
      'view_ap_queue', 'upload_invoice_attachment', 'approve_invoices', 'reject_invoices',
      'process_payments', 'execute_eft_payments', 'view_payment_records',
      'view_vendors', 'create_vendors', 'edit_vendors', 'delete_vendors',
      'view_contracts', 'upload_contracts', 'edit_contracts',
      'view_financial_reports', 'export_reports',
      'manage_permissions', 'manage_users', 'manage_roles', 'view_system_logs'
    ));
  END IF;
END $$;

-- Create composite index for faster lookups
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_permission 
  ON role_permissions(role, permission);

-- Add updated_at trigger if not exists
CREATE OR REPLACE FUNCTION update_role_permissions_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS role_permissions_updated_at ON role_permissions;
CREATE TRIGGER role_permissions_updated_at
  BEFORE UPDATE ON role_permissions
  FOR EACH ROW
  EXECUTE FUNCTION update_role_permissions_timestamp();

-- Ensure RLS is enabled
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- Verify unique constraint exists (the original migration should have this)
-- If not, add it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'role_permissions_role_permission_key'
  ) THEN
    ALTER TABLE role_permissions 
    ADD CONSTRAINT role_permissions_role_permission_key 
    UNIQUE (role, permission);
  END IF;
END $$;

-- Add comment
COMMENT ON TABLE role_permissions IS 'Dynamic RBAC permissions matrix with validation constraints';
