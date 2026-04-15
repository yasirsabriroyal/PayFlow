-- Diagnose audit_logs table

-- 1. Check total count of audit_logs
SELECT 'Total audit logs' as check_type, COUNT(*) as count FROM audit_logs;

-- 2. Check distinct entity_types
SELECT 'Entity types' as check_type, entity_type, COUNT(*) as count 
FROM audit_logs 
GROUP BY entity_type 
ORDER BY count DESC;

-- 3. Check recent audit logs
SELECT 'Recent audit logs' as check_type, id, entity_type, entity_id, action, description, created_at
FROM audit_logs 
ORDER BY created_at DESC 
LIMIT 20;

-- 4. Check if there are any audit logs for paid invoices
SELECT 'Audit logs for paid invoices' as check_type, al.* 
FROM audit_logs al
JOIN invoices i ON al.entity_id::uuid = i.id
WHERE i.status = 'paid'
ORDER BY al.created_at DESC
LIMIT 10;

-- 5. Check audit logs with entity_type = 'invoice'
SELECT 'Invoice entity type logs' as check_type, * 
FROM audit_logs 
WHERE entity_type = 'invoice'
ORDER BY created_at DESC
LIMIT 10;
