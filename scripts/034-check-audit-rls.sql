-- Check RLS policies on audit_logs
SELECT 
  policyname,
  cmd as command,
  permissive,
  qual::text as using_expression,
  with_check::text as with_check_expression
FROM pg_policies 
WHERE tablename = 'audit_logs';

-- Check if action column has valid values
SELECT DISTINCT unnest(enum_range(NULL::audit_action_enum)) as valid_action_values;

-- Also check the audit_action_enum type
SELECT enumlabel 
FROM pg_enum 
WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'audit_action_enum');
