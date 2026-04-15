-- Clean up test audit log entry
DELETE FROM audit_logs WHERE description = 'Test audit log entry';

-- Verify audit_logs is clean
SELECT COUNT(*) as audit_count FROM audit_logs;
