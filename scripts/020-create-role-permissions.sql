-- Create role_permissions table for dynamic RBAC
-- This table stores the mapping between roles and their permissions

-- Create the table
CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role VARCHAR(50) NOT NULL,
  permission VARCHAR(100) NOT NULL,
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure unique role-permission combinations
  UNIQUE(role, permission)
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission);

-- Enable RLS
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- RLS policies
-- Only admins with manage_permissions can modify
CREATE POLICY "role_permissions_select" ON role_permissions
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "role_permissions_all_admin" ON role_permissions
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u 
      WHERE u.auth_user_id = auth.uid() 
      AND u.role = 'admin'
    )
  );

-- Seed default permissions for Admin role
INSERT INTO role_permissions (role, permission) VALUES
  ('admin', 'view_projects'),
  ('admin', 'create_projects'),
  ('admin', 'edit_projects'),
  ('admin', 'archive_projects'),
  ('admin', 'create_payment_certificate'),
  ('admin', 'edit_payment_certificate'),
  ('admin', 'view_payment_history'),
  ('admin', 'view_ap_queue'),
  ('admin', 'upload_invoice_attachment'),
  ('admin', 'approve_invoices'),
  ('admin', 'reject_invoices'),
  ('admin', 'process_payments'),
  ('admin', 'execute_eft_payments'),
  ('admin', 'view_payment_records'),
  ('admin', 'view_vendors'),
  ('admin', 'create_vendors'),
  ('admin', 'edit_vendors'),
  ('admin', 'delete_vendors'),
  ('admin', 'view_contracts'),
  ('admin', 'upload_contracts'),
  ('admin', 'edit_contracts'),
  ('admin', 'view_financial_reports'),
  ('admin', 'export_reports'),
  ('admin', 'manage_permissions'),
  ('admin', 'manage_users'),
  ('admin', 'manage_roles'),
  ('admin', 'view_system_logs')
ON CONFLICT (role, permission) DO NOTHING;

-- Seed default permissions for Project Manager role
INSERT INTO role_permissions (role, permission) VALUES
  ('project_manager', 'view_projects'),
  ('project_manager', 'create_projects'),
  ('project_manager', 'edit_projects'),
  ('project_manager', 'create_payment_certificate'),
  ('project_manager', 'view_payment_history'),
  ('project_manager', 'view_ap_queue'),
  ('project_manager', 'approve_invoices'),
  ('project_manager', 'reject_invoices'),
  ('project_manager', 'view_payment_records'),
  ('project_manager', 'view_vendors'),
  ('project_manager', 'edit_vendors'),
  ('project_manager', 'view_contracts'),
  ('project_manager', 'upload_contracts'),
  ('project_manager', 'view_financial_reports')
ON CONFLICT (role, permission) DO NOTHING;

-- Seed default permissions for Accountant role
INSERT INTO role_permissions (role, permission) VALUES
  ('accountant', 'view_projects'),
  ('accountant', 'view_payment_history'),
  ('accountant', 'view_ap_queue'),
  ('accountant', 'upload_invoice_attachment'),
  ('accountant', 'process_payments'),
  ('accountant', 'execute_eft_payments'),
  ('accountant', 'view_payment_records'),
  ('accountant', 'view_vendors'),
  ('accountant', 'create_vendors'),
  ('accountant', 'edit_vendors'),
  ('accountant', 'view_contracts'),
  ('accountant', 'view_financial_reports'),
  ('accountant', 'export_reports')
ON CONFLICT (role, permission) DO NOTHING;

-- Add comment
COMMENT ON TABLE role_permissions IS 'Dynamic role-based access control permissions matrix';
