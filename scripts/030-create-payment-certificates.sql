-- =============================================================================
-- STAGE 1: Payment Certificates Schema Migration
-- =============================================================================
-- This migration introduces the payment_certificates table to separate the 
-- concept of "certifying work for payment" from the original invoice.
--
-- Key Changes:
-- 1. Creates payment_certificates table for PM-certified payment amounts
-- 2. Creates payment_certificate_status enum
-- 3. Adds payment_certificate_id to payments table
-- 4. Creates invoice_documents table for unified document management
-- 5. Adds RLS policies for all new tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Create payment_certificate_status enum
-- -----------------------------------------------------------------------------
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_certificate_status') THEN
        CREATE TYPE payment_certificate_status AS ENUM (
            'draft',           -- PM is creating, not yet submitted
            'pending',         -- Submitted, awaiting approval
            'approved',        -- Approved by required tier(s)
            'rejected',        -- Rejected, requires revision
            'paid',            -- Payment has been issued
            'partially_paid',  -- Partial payment issued
            'cancelled'        -- Cancelled/voided
        );
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Create payment_certificates table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Certificate identification
    certificate_number VARCHAR(50) NOT NULL,
    
    -- References
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    
    -- Amounts (all in cents to avoid floating point issues)
    certified_amount_cents BIGINT NOT NULL CHECK (certified_amount_cents > 0),
    holdback_amount_cents BIGINT NOT NULL DEFAULT 0 CHECK (holdback_amount_cents >= 0),
    net_payable_cents BIGINT NOT NULL CHECK (net_payable_cents >= 0),
    
    -- Calculated fields for display (denormalized for performance)
    invoice_total_cents BIGINT NOT NULL,                    -- Snapshot of invoice total at certification time
    previous_certified_cents BIGINT NOT NULL DEFAULT 0,     -- Sum of prior certificates
    remaining_after_this_cents BIGINT NOT NULL DEFAULT 0,   -- Invoice total - (previous + this)
    
    -- Status tracking
    status payment_certificate_status NOT NULL DEFAULT 'draft',
    
    -- Approval workflow
    current_approval_tier approval_tier DEFAULT 'project_manager',
    requires_variance_explanation BOOLEAN DEFAULT FALSE,
    variance_explanation TEXT,
    
    -- Work period (optional, for progress billing)
    work_period_start DATE,
    work_period_end DATE,
    
    -- Description/notes
    description TEXT,
    notes TEXT,
    
    -- Audit fields
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submitted_at TIMESTAMPTZ,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    rejected_by UUID REFERENCES users(id),
    rejected_at TIMESTAMPTZ,
    rejection_reason TEXT,
    
    -- QuickBooks sync
    qb_bill_payment_id VARCHAR(255),
    qb_synced_at TIMESTAMPTZ,
    
    -- Constraints
    CONSTRAINT valid_amounts CHECK (
        net_payable_cents = certified_amount_cents - holdback_amount_cents
    ),
    CONSTRAINT valid_remaining CHECK (
        remaining_after_this_cents >= 0
    )
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_payment_certificates_invoice ON payment_certificates(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_certificates_contractor ON payment_certificates(contractor_id);
CREATE INDEX IF NOT EXISTS idx_payment_certificates_project ON payment_certificates(project_id);
CREATE INDEX IF NOT EXISTS idx_payment_certificates_status ON payment_certificates(status);
CREATE INDEX IF NOT EXISTS idx_payment_certificates_created_at ON payment_certificates(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_certificates_number ON payment_certificates(certificate_number);

-- Unique constraint on certificate number
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_certificates_number_unique 
ON payment_certificates(certificate_number);

-- -----------------------------------------------------------------------------
-- 3. Add payment_certificate_id to payments table
-- -----------------------------------------------------------------------------
ALTER TABLE payments 
ADD COLUMN IF NOT EXISTS payment_certificate_id UUID REFERENCES payment_certificates(id);

CREATE INDEX IF NOT EXISTS idx_payments_certificate ON payments(payment_certificate_id);

-- -----------------------------------------------------------------------------
-- 4. Create invoice_documents table for unified document management
-- -----------------------------------------------------------------------------
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_entity_type') THEN
        CREATE TYPE document_entity_type AS ENUM (
            'invoice',
            'payment_certificate',
            'payment'
        );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS invoice_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Polymorphic reference - one of these should be set
    entity_type document_entity_type NOT NULL,
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    payment_certificate_id UUID REFERENCES payment_certificates(id) ON DELETE CASCADE,
    payment_id UUID REFERENCES payments(id) ON DELETE CASCADE,
    
    -- File information
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(100),
    file_url TEXT NOT NULL,
    file_size_bytes BIGINT,
    
    -- Document metadata
    document_type VARCHAR(100), -- e.g., 'original_invoice', 'supporting_doc', 'receipt', 'lien_waiver'
    description TEXT,
    
    -- Audit fields
    uploaded_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Ensure exactly one entity reference is set
    CONSTRAINT valid_entity_reference CHECK (
        (entity_type = 'invoice' AND invoice_id IS NOT NULL AND payment_certificate_id IS NULL AND payment_id IS NULL) OR
        (entity_type = 'payment_certificate' AND payment_certificate_id IS NOT NULL AND invoice_id IS NULL AND payment_id IS NULL) OR
        (entity_type = 'payment' AND payment_id IS NOT NULL AND invoice_id IS NULL AND payment_certificate_id IS NULL)
    )
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_invoice_documents_invoice ON invoice_documents(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_documents_certificate ON invoice_documents(payment_certificate_id) WHERE payment_certificate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_documents_payment ON invoice_documents(payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_documents_entity_type ON invoice_documents(entity_type);

-- -----------------------------------------------------------------------------
-- 5. Add columns to invoices table for tracking certified amounts
-- -----------------------------------------------------------------------------
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS total_certified_cents BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_paid_cents BIGINT DEFAULT 0;

-- -----------------------------------------------------------------------------
-- 6. Enable RLS on new tables
-- -----------------------------------------------------------------------------
ALTER TABLE payment_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_documents ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 7. RLS Policies for payment_certificates
-- -----------------------------------------------------------------------------

-- Select: Internal users can view all, contractors can view their own
DROP POLICY IF EXISTS payment_certificates_select_internal ON payment_certificates;
CREATE POLICY payment_certificates_select_internal ON payment_certificates
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.auth_user_id = auth.uid() 
            AND u.role IN ('admin', 'accountant', 'project_manager')
            AND u.is_active = TRUE
        )
    );

DROP POLICY IF EXISTS payment_certificates_select_contractor ON payment_certificates;
CREATE POLICY payment_certificates_select_contractor ON payment_certificates
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM contractors c 
            WHERE c.auth_user_id = auth.uid() 
            AND c.id = payment_certificates.contractor_id
            AND c.status = 'active'
        )
    );

-- Insert: PMs and Admins can create
DROP POLICY IF EXISTS payment_certificates_insert ON payment_certificates;
CREATE POLICY payment_certificates_insert ON payment_certificates
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.auth_user_id = auth.uid() 
            AND u.role IN ('admin', 'project_manager')
            AND u.is_active = TRUE
        )
    );

-- Update: PMs can update drafts, Admins/Accountants can update any
DROP POLICY IF EXISTS payment_certificates_update ON payment_certificates;
CREATE POLICY payment_certificates_update ON payment_certificates
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.auth_user_id = auth.uid() 
            AND u.is_active = TRUE
            AND (
                u.role IN ('admin', 'accountant')
                OR (u.role = 'project_manager' AND payment_certificates.status = 'draft')
            )
        )
    );

-- -----------------------------------------------------------------------------
-- 8. RLS Policies for invoice_documents
-- -----------------------------------------------------------------------------

-- Select: Internal users can view all, contractors can view their related docs
DROP POLICY IF EXISTS invoice_documents_select_internal ON invoice_documents;
CREATE POLICY invoice_documents_select_internal ON invoice_documents
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.auth_user_id = auth.uid() 
            AND u.role IN ('admin', 'accountant', 'project_manager')
            AND u.is_active = TRUE
        )
    );

DROP POLICY IF EXISTS invoice_documents_select_contractor ON invoice_documents;
CREATE POLICY invoice_documents_select_contractor ON invoice_documents
    FOR SELECT
    TO authenticated
    USING (
        -- Invoice documents
        (entity_type = 'invoice' AND EXISTS (
            SELECT 1 FROM invoices i
            JOIN contractors c ON c.id = i.contractor_id
            WHERE i.id = invoice_documents.invoice_id
            AND c.auth_user_id = auth.uid()
        ))
        OR
        -- Payment certificate documents
        (entity_type = 'payment_certificate' AND EXISTS (
            SELECT 1 FROM payment_certificates pc
            JOIN contractors c ON c.id = pc.contractor_id
            WHERE pc.id = invoice_documents.payment_certificate_id
            AND c.auth_user_id = auth.uid()
        ))
        OR
        -- Payment documents
        (entity_type = 'payment' AND EXISTS (
            SELECT 1 FROM payments p
            JOIN contractors c ON c.id = p.contractor_id
            WHERE p.id = invoice_documents.payment_id
            AND c.auth_user_id = auth.uid()
        ))
    );

-- Insert: Internal users can upload
DROP POLICY IF EXISTS invoice_documents_insert ON invoice_documents;
CREATE POLICY invoice_documents_insert ON invoice_documents
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.auth_user_id = auth.uid() 
            AND u.role IN ('admin', 'accountant', 'project_manager')
            AND u.is_active = TRUE
        )
    );

-- Update: Internal users can update
DROP POLICY IF EXISTS invoice_documents_update ON invoice_documents;
CREATE POLICY invoice_documents_update ON invoice_documents
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.auth_user_id = auth.uid() 
            AND u.role IN ('admin', 'accountant', 'project_manager')
            AND u.is_active = TRUE
        )
    );

-- Delete: Admins only
DROP POLICY IF EXISTS invoice_documents_delete ON invoice_documents;
CREATE POLICY invoice_documents_delete ON invoice_documents
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.auth_user_id = auth.uid() 
            AND u.role = 'admin'
            AND u.is_active = TRUE
        )
    );

-- -----------------------------------------------------------------------------
-- 9. Create trigger for updated_at on new tables
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_payment_certificates_updated_at ON payment_certificates;
CREATE TRIGGER update_payment_certificates_updated_at
    BEFORE UPDATE ON payment_certificates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_invoice_documents_updated_at ON invoice_documents;
CREATE TRIGGER update_invoice_documents_updated_at
    BEFORE UPDATE ON invoice_documents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------------------
-- 10. Create helper function to generate certificate numbers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_certificate_number(p_invoice_id UUID)
RETURNS VARCHAR(50) AS $$
DECLARE
    v_invoice_number VARCHAR(50);
    v_count INTEGER;
    v_certificate_number VARCHAR(50);
BEGIN
    -- Get the invoice number
    SELECT invoice_number INTO v_invoice_number
    FROM invoices WHERE id = p_invoice_id;
    
    -- Count existing certificates for this invoice
    SELECT COUNT(*) + 1 INTO v_count
    FROM payment_certificates WHERE invoice_id = p_invoice_id;
    
    -- Generate certificate number: INV-123-PC01, INV-123-PC02, etc.
    v_certificate_number := v_invoice_number || '-PC' || LPAD(v_count::TEXT, 2, '0');
    
    RETURN v_certificate_number;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 11. Create view for invoice payment summary
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_invoice_payment_summary AS
SELECT 
    i.id AS invoice_id,
    i.invoice_number,
    i.total_cents AS invoice_total_cents,
    i.holdback_cents AS invoice_holdback_cents,
    i.net_payable_cents AS invoice_net_payable_cents,
    i.status AS invoice_status,
    COALESCE(SUM(pc.certified_amount_cents) FILTER (WHERE pc.status NOT IN ('cancelled', 'rejected')), 0) AS total_certified_cents,
    COALESCE(SUM(pc.holdback_amount_cents) FILTER (WHERE pc.status NOT IN ('cancelled', 'rejected')), 0) AS total_holdback_certified_cents,
    COALESCE(SUM(pc.net_payable_cents) FILTER (WHERE pc.status = 'paid'), 0) AS total_paid_cents,
    i.total_cents - COALESCE(SUM(pc.certified_amount_cents) FILTER (WHERE pc.status NOT IN ('cancelled', 'rejected')), 0) AS remaining_balance_cents,
    COUNT(pc.id) FILTER (WHERE pc.status NOT IN ('cancelled', 'rejected')) AS certificate_count,
    COUNT(pc.id) FILTER (WHERE pc.status = 'paid') AS paid_certificate_count
FROM invoices i
LEFT JOIN payment_certificates pc ON pc.invoice_id = i.id
GROUP BY i.id, i.invoice_number, i.total_cents, i.holdback_cents, i.net_payable_cents, i.status;

-- Grant access to the view
GRANT SELECT ON v_invoice_payment_summary TO authenticated;

-- -----------------------------------------------------------------------------
-- STAGE 1 COMPLETE
-- -----------------------------------------------------------------------------
-- New tables created:
--   - payment_certificates: PM-certified payment amounts linked to invoices
--   - invoice_documents: Unified document storage for invoices, certificates, payments
--
-- Modified tables:
--   - payments: Added payment_certificate_id column
--   - invoices: Added total_certified_cents, total_paid_cents columns
--
-- New enums:
--   - payment_certificate_status
--   - document_entity_type
--
-- New views:
--   - v_invoice_payment_summary: Aggregated view of invoice payment progress
--
-- Helper functions:
--   - generate_certificate_number(): Auto-generates certificate numbers
-- -----------------------------------------------------------------------------
