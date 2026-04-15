-- Check audit_action enum values
SELECT enumlabel as valid_action 
FROM pg_enum 
WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'audit_action')
ORDER BY enumsortorder;
