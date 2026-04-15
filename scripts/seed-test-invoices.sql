-- Seed Test Data for Payment Workflow
-- Run this script to create test contractors, projects, and invoices

-- First, check if we have any existing projects and contractors
-- If not, create them

-- Create test contractors if none exist
INSERT INTO contractors (
  id, 
  company_name, 
  contact_name, 
  email, 
  phone,
  address_line1,
  city,
  province,
  postal_code,
  status,
  bank_name,
  bank_institution_number,
  bank_transit_number,
  bank_account_number,
  wcb_account_number,
  wcb_clearance_expiry,
  business_number,
  created_at,
  updated_at
)
SELECT 
  gen_random_uuid(),
  'ABC Electrical Ltd.',
  'John Smith',
  'john@abcelectrical.com',
  '416-555-0101',
  '123 Contractor Way',
  'Toronto',
  'ON',
  'M5V 1A1',
  'active',
  'TD Canada Trust',
  '004',
  '12345',
  '1234567890',
  'WCB-001234',
  (CURRENT_DATE + INTERVAL '1 year')::date,
  'BN123456789',
  NOW(),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM contractors WHERE company_name = 'ABC Electrical Ltd.')
RETURNING id;

INSERT INTO contractors (
  id, 
  company_name, 
  contact_name, 
  email, 
  phone,
  address_line1,
  city,
  province,
  postal_code,
  status,
  bank_name,
  bank_institution_number,
  bank_transit_number,
  bank_account_number,
  wcb_account_number,
  wcb_clearance_expiry,
  business_number,
  created_at,
  updated_at
)
SELECT 
  gen_random_uuid(),
  'Superior Plumbing Inc.',
  'Jane Doe',
  'jane@superiorplumbing.com',
  '416-555-0102',
  '456 Trade Street',
  'Toronto',
  'ON',
  'M5V 2B2',
  'active',
  'RBC Royal Bank',
  '003',
  '67890',
  '0987654321',
  'WCB-005678',
  (CURRENT_DATE + INTERVAL '6 months')::date,
  'BN987654321',
  NOW(),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM contractors WHERE company_name = 'Superior Plumbing Inc.')
RETURNING id;

-- Create test project if none exist
INSERT INTO projects (
  id,
  project_number,
  name,
  description,
  address_line1,
  city,
  province,
  start_date,
  estimated_completion_date,
  original_budget_cents,
  current_budget_cents,
  spent_cents,
  committed_cents,
  is_active,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  'PRJ-2024-001',
  'Oakwood Towers - Phase 1',
  'Residential tower construction project',
  '100 Oakwood Ave',
  'Toronto',
  'ON',
  CURRENT_DATE - INTERVAL '3 months',
  CURRENT_DATE + INTERVAL '12 months',
  500000000, -- $5M budget
  500000000,
  0,
  0,
  true,
  NOW(),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM projects WHERE project_number = 'PRJ-2024-001')
RETURNING id;

-- Now create test invoices using the contractors and projects we just created
-- Get IDs from existing data
DO $$
DECLARE
  v_contractor_1_id UUID;
  v_contractor_2_id UUID;
  v_project_id UUID;
BEGIN
  -- Get contractor IDs
  SELECT id INTO v_contractor_1_id FROM contractors WHERE company_name = 'ABC Electrical Ltd.' LIMIT 1;
  SELECT id INTO v_contractor_2_id FROM contractors WHERE company_name = 'Superior Plumbing Inc.' LIMIT 1;
  SELECT id INTO v_project_id FROM projects WHERE project_number = 'PRJ-2024-001' LIMIT 1;
  
  -- Only proceed if we have all required IDs
  IF v_contractor_1_id IS NOT NULL AND v_project_id IS NOT NULL THEN
    -- Create invoice 1 - Pending (for approval queue)
    INSERT INTO invoices (
      id,
      contractor_id,
      project_id,
      invoice_number,
      invoice_date,
      due_date,
      subtotal_cents,
      gst_hst_rate,
      gst_hst_cents,
      total_cents,
      holdback_percent,
      holdback_cents,
      net_payable_cents,
      amount_paid_cents,
      amount_remaining_cents,
      status,
      source,
      created_at,
      updated_at
    )
    SELECT
      gen_random_uuid(),
      v_contractor_1_id,
      v_project_id,
      'INV-2024-0001',
      CURRENT_DATE - INTERVAL '5 days',
      CURRENT_DATE + INTERVAL '25 days',
      4500000, -- $45,000.00
      0.13,
      585000, -- 13% HST
      5085000, -- $50,850.00 total
      0.10, -- 10% holdback
      508500,
      4576500, -- Net payable after holdback
      0, -- amount_paid_cents
      4576500, -- amount_remaining_cents (same as net_payable initially)
      'submitted',
      'manual',
      NOW(),
      NOW()
    WHERE NOT EXISTS (SELECT 1 FROM invoices WHERE invoice_number = 'INV-2024-0001');
    
    -- Create invoice 2 - Approved (for payment run)
    INSERT INTO invoices (
      id,
      contractor_id,
      project_id,
      invoice_number,
      invoice_date,
      due_date,
      subtotal_cents,
      gst_hst_rate,
      gst_hst_cents,
      total_cents,
      holdback_percent,
      holdback_cents,
      net_payable_cents,
      amount_paid_cents,
      amount_remaining_cents,
      status,
      source,
      created_at,
      updated_at
    )
    SELECT
      gen_random_uuid(),
      v_contractor_1_id,
      v_project_id,
      'INV-2024-0002',
      CURRENT_DATE - INTERVAL '10 days',
      CURRENT_DATE + INTERVAL '20 days',
      7850000, -- $78,500.00
      0.13,
      1020500,
      8870500,
      0.10,
      887050,
      7983450,
      0,
      7983450,
      'approved', -- Ready for payment
      'manual',
      NOW(),
      NOW()
    WHERE NOT EXISTS (SELECT 1 FROM invoices WHERE invoice_number = 'INV-2024-0002');
  END IF;
  
  IF v_contractor_2_id IS NOT NULL AND v_project_id IS NOT NULL THEN
    -- Create invoice 3 - Pending
    INSERT INTO invoices (
      id,
      contractor_id,
      project_id,
      invoice_number,
      invoice_date,
      due_date,
      subtotal_cents,
      gst_hst_rate,
      gst_hst_cents,
      total_cents,
      holdback_percent,
      holdback_cents,
      net_payable_cents,
      amount_paid_cents,
      amount_remaining_cents,
      status,
      source,
      created_at,
      updated_at
    )
    SELECT
      gen_random_uuid(),
      v_contractor_2_id,
      v_project_id,
      'INV-2024-0003',
      CURRENT_DATE - INTERVAL '3 days',
      CURRENT_DATE + INTERVAL '27 days',
      3200000, -- $32,000.00
      0.13,
      416000,
      3616000,
      0.10,
      361600,
      3254400,
      0,
      3254400,
      'submitted',
      'manual',
      NOW(),
      NOW()
    WHERE NOT EXISTS (SELECT 1 FROM invoices WHERE invoice_number = 'INV-2024-0003');
    
    -- Create invoice 4 - Approved
    INSERT INTO invoices (
      id,
      contractor_id,
      project_id,
      invoice_number,
      invoice_date,
      due_date,
      subtotal_cents,
      gst_hst_rate,
      gst_hst_cents,
      total_cents,
      holdback_percent,
      holdback_cents,
      net_payable_cents,
      amount_paid_cents,
      amount_remaining_cents,
      status,
      source,
      created_at,
      updated_at
    )
    SELECT
      gen_random_uuid(),
      v_contractor_2_id,
      v_project_id,
      'INV-2024-0004',
      CURRENT_DATE - INTERVAL '7 days',
      CURRENT_DATE + INTERVAL '23 days',
      5500000, -- $55,000.00
      0.13,
      715000,
      6215000,
      0.10,
      621500,
      5593500,
      0,
      5593500,
      'approved', -- Ready for payment
      'manual',
      NOW(),
      NOW()
    WHERE NOT EXISTS (SELECT 1 FROM invoices WHERE invoice_number = 'INV-2024-0004');
  END IF;
END $$;

-- Verify the data was created
SELECT 'Contractors created:' as info, COUNT(*) as count FROM contractors;
SELECT 'Projects created:' as info, COUNT(*) as count FROM projects;
SELECT 'Invoices created:' as info, COUNT(*) as count FROM invoices;
SELECT 'Submitted invoices:' as info, COUNT(*) as count FROM invoices WHERE status = 'submitted';
SELECT 'Approved invoices:' as info, COUNT(*) as count FROM invoices WHERE status = 'approved';
