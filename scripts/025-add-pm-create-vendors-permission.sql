-- Migration to add create_vendors permission to project_manager role
-- This allows PMs to add new contractors from their view

-- Add the create_vendors permission to project_manager role
INSERT INTO role_permissions (role, permission) VALUES
  ('project_manager', 'create_vendors')
ON CONFLICT (role, permission) DO NOTHING;

-- Verify the permission was added
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM role_permissions 
    WHERE role = 'project_manager' AND permission = 'create_vendors'
  ) THEN
    RAISE NOTICE 'Successfully added create_vendors permission to project_manager role';
  ELSE
    RAISE WARNING 'Failed to add create_vendors permission to project_manager role';
  END IF;
END $$;
