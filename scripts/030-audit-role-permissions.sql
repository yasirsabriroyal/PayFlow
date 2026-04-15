-- Comprehensive Role Permissions Audit and Fix
-- Ensures all roles have their correct default permissions

-- =====================================================
-- ADMIN ROLE - Full access to everything
-- =====================================================
INSERT INTO role_permissions (role, permission) VALUES
-- Projects
('admin', 'view_projects'),
('admin', 'create_projects'),
('admin', 'edit_projects'),
('admin', 'archive_projects'),
-- Payment Certificates
('admin', 'create_payment_certificate'),
('admin', 'edit_payment_certificate'),
('admin', 'view_payment_history'),
-- Invoices
('admin', 'view_ap_queue'),
('admin', 'create_invoice'),
('admin', 'upload_invoice_attachment'),
('admin', 'approve_invoices'),
('admin', 'reject_invoices'),
-- Payments
('admin', 'process_payments'),
('admin', 'execute_eft_payments'),
('admin', 'view_payment_records'),
('admin', 'create_direct_payment'),
-- Vendors
('admin', 'view_vendors'),
('admin', 'create_vendors'),
('admin', 'edit_vendors'),
('admin', 'delete_vendors'),
-- Contracts
('admin', 'view_contracts'),
('admin', 'upload_contracts'),
('admin', 'edit_contracts'),
-- Reporting
('admin', 'view_financial_reports'),
('admin', 'export_reports'),
-- Administration
('admin', 'manage_permissions'),
('admin', 'manage_users'),
('admin', 'manage_roles'),
('admin', 'view_system_logs')
ON CONFLICT (role, permission) DO NOTHING;

-- =====================================================
-- PROJECT MANAGER ROLE
-- =====================================================
INSERT INTO role_permissions (role, permission) VALUES
-- Projects
('project_manager', 'view_projects'),
('project_manager', 'create_projects'),
('project_manager', 'edit_projects'),
-- Payment Certificates
('project_manager', 'create_payment_certificate'),
('project_manager', 'view_payment_history'),
-- Invoices
('project_manager', 'view_ap_queue'),
('project_manager', 'create_invoice'),
('project_manager', 'upload_invoice_attachment'),
('project_manager', 'approve_invoices'),
('project_manager', 'reject_invoices'),
-- Payments
('project_manager', 'view_payment_records'),
-- Vendors
('project_manager', 'view_vendors'),
('project_manager', 'create_vendors'),
('project_manager', 'edit_vendors'),
-- Contracts
('project_manager', 'view_contracts'),
('project_manager', 'upload_contracts'),
-- Reporting
('project_manager', 'view_financial_reports')
ON CONFLICT (role, permission) DO NOTHING;

-- =====================================================
-- ACCOUNTANT ROLE
-- =====================================================
INSERT INTO role_permissions (role, permission) VALUES
-- Projects
('accountant', 'view_projects'),
-- Payment Certificates
('accountant', 'view_payment_history'),
('accountant', 'create_payment_certificate'),
('accountant', 'edit_payment_certificate'),
-- Invoices
('accountant', 'view_ap_queue'),
('accountant', 'upload_invoice_attachment'),
('accountant', 'approve_invoices'),
('accountant', 'reject_invoices'),
-- Payments
('accountant', 'process_payments'),
('accountant', 'execute_eft_payments'),
('accountant', 'view_payment_records'),
('accountant', 'create_direct_payment'),
-- Vendors
('accountant', 'view_vendors'),
('accountant', 'create_vendors'),
('accountant', 'edit_vendors'),
-- Contracts
('accountant', 'view_contracts'),
-- Reporting
('accountant', 'view_financial_reports'),
('accountant', 'export_reports')
ON CONFLICT (role, permission) DO NOTHING;

-- =====================================================
-- CONTRACTOR ROLE
-- =====================================================
INSERT INTO role_permissions (role, permission) VALUES
('contractor', 'view_vendors'),
('contractor', 'view_contracts'),
('contractor', 'upload_invoice_attachment')
ON CONFLICT (role, permission) DO NOTHING;

-- Verify the permissions are in place
SELECT role, array_agg(permission ORDER BY permission) as permissions
FROM role_permissions
GROUP BY role
ORDER BY role;
