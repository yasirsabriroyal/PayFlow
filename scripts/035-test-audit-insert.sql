-- Test audit log insert to diagnose why inserts are failing

-- First, show the audit_logs table structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'audit_logs'
ORDER BY ordinal_position;

-- Check if RLS is enabled
SELECT relname, relrowsecurity 
FROM pg_class 
WHERE relname = 'audit_logs';

-- Try to insert a test audit log entry
INSERT INTO audit_logs (
    action,
    entity_type,
    entity_id,
    user_id,
    description,
    created_at
) VALUES (
    'test_action',
    'test',
    '00000000-0000-0000-0000-000000000000',
    (SELECT id FROM users LIMIT 1),
    'Test audit log entry',
    NOW()
)
RETURNING id, action, entity_type, description;

-- Count after insert
SELECT COUNT(*) as total_audit_logs FROM audit_logs;
