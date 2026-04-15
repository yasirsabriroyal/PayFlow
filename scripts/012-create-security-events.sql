-- =====================================================
-- SECURITY EVENTS TABLE
-- Enterprise RBAC telemetry for authorization monitoring
-- =====================================================

-- Create security_events table for authorization telemetry
CREATE TABLE IF NOT EXISTS security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_role TEXT,
  permission TEXT,
  action_name TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_security_events_type 
  ON security_events(event_type);

CREATE INDEX IF NOT EXISTS idx_security_events_user_id 
  ON security_events(user_id);

CREATE INDEX IF NOT EXISTS idx_security_events_created_at 
  ON security_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_permission 
  ON security_events(permission);

-- Composite index for common filtered queries
CREATE INDEX IF NOT EXISTS idx_security_events_type_created 
  ON security_events(event_type, created_at DESC);

-- Add comments for documentation
COMMENT ON TABLE security_events IS 'Authorization telemetry for RBAC security monitoring';
COMMENT ON COLUMN security_events.event_type IS 'Type of security event (permission_denied, permission_granted, auth_failure, etc.)';
COMMENT ON COLUMN security_events.user_id IS 'User who triggered the event (null for unauthenticated)';
COMMENT ON COLUMN security_events.user_role IS 'Role of the user at time of event';
COMMENT ON COLUMN security_events.permission IS 'Permission that was checked';
COMMENT ON COLUMN security_events.action_name IS 'Server action or route that was accessed';
COMMENT ON COLUMN security_events.metadata IS 'Additional event details (IP, user agent, etc.)';

-- Enable RLS but allow service role full access
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;

-- Only admins with view_system_logs permission can read security events
-- (enforced at application level, RLS allows authenticated read for admins)
CREATE POLICY "Admins can view security events" ON security_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.auth_user_id = auth.uid()
      AND u.role = 'admin'
    )
  );

-- Service role can insert security events
CREATE POLICY "Service role can insert security events" ON security_events
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Allow authenticated users to insert their own events (for client-side logging)
CREATE POLICY "Authenticated users can log their own events" ON security_events
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- Create a function to clean up old security events (retention policy)
CREATE OR REPLACE FUNCTION cleanup_old_security_events(retention_days INTEGER DEFAULT 90)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM security_events
  WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION cleanup_old_security_events IS 'Removes security events older than specified retention period';

-- Grant execute permission to service role
GRANT EXECUTE ON FUNCTION cleanup_old_security_events TO service_role;
