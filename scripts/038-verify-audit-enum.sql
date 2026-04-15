-- Verify the audit_action enum values
SELECT unnest(enum_range(NULL::audit_action)) AS valid_actions;

-- Test insert with a common action value
INSERT INTO audit_logs (
    action,
    entity_type,
    entity_id,
    description,
    created_at
) VALUES (
    'invoice_approved',
    'invoice',
    '00000000-0000-0000-0000-000000000001',
    'Test audit log entry',
    NOW()
);

-- Check if insert succeeded
SELECT COUNT(*) as audit_count FROM audit_logs;

-- Show recent audit logs
SELECT id, action, entity_type, description, created_at 
FROM audit_logs 
ORDER BY created_at DESC 
LIMIT 5;
