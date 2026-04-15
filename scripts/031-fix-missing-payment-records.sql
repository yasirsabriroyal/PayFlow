-- Fix missing payment records for invoices that have total_paid_cents but no payment records
-- This creates payment records linked to payment_requests for invoices that were paid
-- but don't have corresponding payment records

-- First, find invoices that are marked as paid but have no payment records
-- and create payment_requests if they don't exist, then create payments

DO $$
DECLARE
    inv RECORD;
    pr_id uuid;
    admin_user_id uuid;
BEGIN
    -- Get an admin user ID for the processed_by field
    SELECT id INTO admin_user_id FROM users WHERE role = 'admin' LIMIT 1;
    
    -- If no admin found, use any user
    IF admin_user_id IS NULL THEN
        SELECT id INTO admin_user_id FROM users LIMIT 1;
    END IF;
    
    -- Find paid invoices with amount_paid_cents > 0 but no matching payments
    FOR inv IN 
        SELECT 
            i.id,
            i.invoice_number,
            i.contractor_id,
            COALESCE(NULLIF(i.amount_paid_cents, 0), i.total_paid_cents, i.net_payable_cents) as total_paid_cents,
            i.total_cents,
            i.net_payable_cents
        FROM invoices i
        WHERE i.status = 'paid'
        AND (i.amount_paid_cents > 0 OR i.total_paid_cents > 0)
        AND NOT EXISTS (
            -- Check for certificate-linked payments
            SELECT 1 FROM payments p
            JOIN payment_certificates pc ON p.payment_certificate_id = pc.id
            WHERE pc.invoice_id = i.id
        )
        AND NOT EXISTS (
            -- Check for payment_request-linked payments
            SELECT 1 FROM payments p
            JOIN payment_requests pr ON p.payment_request_id = pr.id
            WHERE pr.invoice_id = i.id
        )
    LOOP
        RAISE NOTICE 'Processing invoice % (%) with paid amount %', inv.invoice_number, inv.id, inv.total_paid_cents;
        
        -- First check if there's an approved/paid certificate
        SELECT pc.id INTO pr_id
        FROM payment_certificates pc
        WHERE pc.invoice_id = inv.id
        AND pc.status IN ('approved', 'paid')
        LIMIT 1;
        
        IF pr_id IS NOT NULL THEN
            -- Create payment linked to certificate
            INSERT INTO payments (
                payment_certificate_id,
                contractor_id,
                amount_cents,
                payment_method,
                payment_date,
                status,
                processed_by,
                notes,
                created_at
            ) VALUES (
                pr_id,
                inv.contractor_id,
                inv.total_paid_cents,
                'eft',
                CURRENT_DATE,
                'cleared',
                admin_user_id,
                'Auto-created to fix missing payment record',
                NOW()
            );
            
            -- Update certificate to paid
            UPDATE payment_certificates
            SET status = 'paid', updated_at = NOW()
            WHERE id = pr_id;
            
            RAISE NOTICE '  -> Created payment linked to certificate %', pr_id;
        ELSE
            -- Check for existing payment_request
            SELECT pr.id INTO pr_id
            FROM payment_requests pr
            WHERE pr.invoice_id = inv.id
            LIMIT 1;
            
            IF pr_id IS NULL THEN
                -- Create a payment request
                INSERT INTO payment_requests (
                    request_number,
                    invoice_id,
                    contractor_id,
                    requested_amount_cents,
                    approved_amount_cents,
                    status,
                    payment_method,
                    payment_reference,
                    processed_by,
                    processed_at,
                    created_at
                ) VALUES (
                    'PR-FIX-' || EXTRACT(EPOCH FROM NOW())::bigint || '-' || UPPER(SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 5)),
                    inv.id,
                    inv.contractor_id,
                    inv.total_paid_cents,
                    inv.total_paid_cents,
                    'paid',
                    'eft',
                    'AUTO-FIX-' || inv.invoice_number,
                    admin_user_id,
                    NOW(),
                    NOW()
                )
                RETURNING id INTO pr_id;
                
                RAISE NOTICE '  -> Created payment request %', pr_id;
            ELSE
                -- Update existing payment request to paid
                UPDATE payment_requests
                SET status = 'paid', 
                    payment_method = COALESCE(payment_method, 'eft'),
                    processed_at = COALESCE(processed_at, NOW()),
                    updated_at = NOW()
                WHERE id = pr_id;
            END IF;
            
            -- Create payment linked to payment_request
            INSERT INTO payments (
                payment_request_id,
                contractor_id,
                amount_cents,
                payment_method,
                payment_date,
                status,
                processed_by,
                notes,
                created_at
            ) VALUES (
                pr_id,
                inv.contractor_id,
                inv.total_paid_cents,
                'eft',
                CURRENT_DATE,
                'cleared',
                admin_user_id,
                'Auto-created to fix missing payment record',
                NOW()
            );
            
            RAISE NOTICE '  -> Created payment linked to payment_request %', pr_id;
        END IF;
    END LOOP;
END $$;

-- Show summary of what was fixed
SELECT 
    'Summary: Invoices with payments' as description,
    COUNT(DISTINCT i.id) as count
FROM invoices i
WHERE i.status = 'paid'
AND (
    EXISTS (
        SELECT 1 FROM payments p
        JOIN payment_certificates pc ON p.payment_certificate_id = pc.id
        WHERE pc.invoice_id = i.id
    )
    OR EXISTS (
        SELECT 1 FROM payments p
        JOIN payment_requests pr ON p.payment_request_id = pr.id
        WHERE pr.invoice_id = i.id
    )
);
