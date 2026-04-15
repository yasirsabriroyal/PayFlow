-- Diagnostic query to understand payment data

-- 1. Show all paid invoices
SELECT 'Paid invoices' as check_type, 
       id, 
       invoice_number, 
       status, 
       total_cents, 
       total_paid_cents,
       amount_paid_cents
FROM invoices 
WHERE status = 'paid';

-- 2. Show all payments
SELECT 'All payments' as check_type, 
       id,
       payment_request_id,
       payment_certificate_id,
       amount_cents,
       status,
       payment_method
FROM payments;

-- 3. Show all payment_requests
SELECT 'All payment_requests' as check_type,
       id,
       request_number,
       invoice_id,
       status,
       requested_amount_cents,
       approved_amount_cents
FROM payment_requests;

-- 4. Show all payment_certificates
SELECT 'All payment_certificates' as check_type,
       id,
       certificate_number,
       invoice_id,
       status,
       net_payable_cents
FROM payment_certificates;
