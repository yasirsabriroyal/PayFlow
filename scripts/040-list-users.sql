-- List all users in the system
SELECT 
    id,
    email,
    first_name,
    last_name,
    role,
    created_at
FROM users
ORDER BY role, created_at;
