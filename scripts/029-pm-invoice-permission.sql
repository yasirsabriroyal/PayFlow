-- Add create_invoice permission for project_manager role if not exists
-- This ensures PMs can create invoices through the portal

INSERT INTO role_permissions (role, permission)
VALUES ('project_manager', 'create_invoice')
ON CONFLICT DO NOTHING;

-- Also ensure view_ap_queue and view_vendors are present for the invoice creation flow
INSERT INTO role_permissions (role, permission)
VALUES ('project_manager', 'view_ap_queue')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role, permission)
VALUES ('project_manager', 'view_vendors')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role, permission)
VALUES ('project_manager', 'view_projects')
ON CONFLICT DO NOTHING;

-- Verify the permissions
SELECT role, permission FROM role_permissions WHERE role = 'project_manager' ORDER BY permission;
