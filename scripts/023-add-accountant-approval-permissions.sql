-- Add approve_invoices and reject_invoices permissions for accountant role
-- Accountants need these permissions to process invoices in their queue

INSERT INTO role_permissions (role, permission) VALUES
  ('accountant', 'approve_invoices'),
  ('accountant', 'reject_invoices')
ON CONFLICT (role, permission) DO NOTHING;

-- Verify the permissions were added
-- SELECT * FROM role_permissions WHERE role = 'accountant';
