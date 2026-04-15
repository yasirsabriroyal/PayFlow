-- =============================================================================
-- ENTERPRISE AP & FINANCE SYSTEM (CANADA) - DIAMOND EDITION
-- Complete PostgreSQL Schema
-- =============================================================================
-- This schema supports:
-- - User roles with mandatory 2FA for Admin/Accountant
-- - Contractor management with KYC compliance
-- - Canadian tax engine (GST/HST/QST/PST)
-- - Progressive billing with change orders
-- - Tiered approval workflow
-- - Short-pay disputes
-- - Statutory declarations (lien waivers)
-- - Holdback ledger with 45-day countdown (Builder's Lien Act)
-- - QuickBooks integration sync
-- - Immutable audit logging
-- - AI anomaly detection flags
-- =============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- ENUM TYPES
-- =============================================================================

-- User roles enum
CREATE TYPE user_role AS ENUM (
  'admin',
  'accountant', 
  'project_manager',
  'contractor'
);

-- Contractor status
CREATE TYPE contractor_status AS ENUM (
  'active',
  'inactive',
  'pending_kyc',
  'suspended'
);

-- Canadian provinces for tax calculation
CREATE TYPE canadian_province AS ENUM (
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'
);

-- Invoice status
CREATE TYPE invoice_status AS ENUM (
  'draft',
  'submitted',
  'pending_approval',
  'approved',
  'rejected',
  'paid',
  'partially_paid',
  'disputed'
);

-- Payment request status (workflow stages)
CREATE TYPE payment_request_status AS ENUM (
  'ingested',           -- Stage A: Initial intake
  'pending',            -- Stage B: Pending review
  'pending_approval',   -- Stage C: In tiered approval
  'approved',           -- Approved, ready for processing
  'processing',         -- Stage D: Accountant processing
  'awaiting_stat_dec',  -- Waiting for lien waiver signature
  'holdback',           -- Stage E: In holdback period
  'paid',               -- Stage E: Fully paid
  'rejected',
  'disputed'
);

-- Approval decision
CREATE TYPE approval_decision AS ENUM (
  'pending',
  'approved',
  'rejected',
  'short_pay'
);

-- Approval tier
CREATE TYPE approval_tier AS ENUM (
  'project_manager',    -- Under $1,000
  'general_manager',    -- $1,000 - $10,000
  'admin'               -- Over $10,000
);

-- Holdback status
CREATE TYPE holdback_status AS ENUM (
  'withheld',
  'countdown_started',
  'released',
  'disputed'
);

-- KYC document type
CREATE TYPE kyc_document_type AS ENUM (
  'wcb_clearance',
  'wsib_clearance',
  't5018_info',
  'void_cheque',
  'business_license',
  'insurance_certificate',
  'other'
);

-- KYC document status
CREATE TYPE kyc_document_status AS ENUM (
  'pending',
  'verified',
  'rejected',
  'expired'
);

-- Payment method
CREATE TYPE payment_method AS ENUM (
  'eft',
  'cheque',
  'wire',
  'etransfer'
);

-- Anomaly type
CREATE TYPE anomaly_type AS ENUM (
  'duplicate_invoice',
  'abnormal_frequency',
  'unusually_high_amount',
  'budget_exceeded',
  'wcb_expired',
  'missing_stat_dec',
  'suspicious_pattern'
);

-- Anomaly severity
CREATE TYPE anomaly_severity AS ENUM (
  'low',
  'medium',
  'high',
  'critical'
);

-- QuickBooks sync status
CREATE TYPE qb_sync_status AS ENUM (
  'pending',
  'synced',
  'failed',
  'skipped'
);

-- Audit action type
CREATE TYPE audit_action AS ENUM (
  'create',
  'update',
  'delete',
  'approve',
  'reject',
  'short_pay',
  'release_holdback',
  'generate_eft',
  'sign_stat_dec',
  'login',
  'logout',
  'export',
  'sync'
);

-- =============================================================================
-- CORE TABLES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. USERS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL UNIQUE,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  role user_role NOT NULL DEFAULT 'project_manager',
  phone VARCHAR(20),
  
  -- 2FA fields (mandatory for admin/accountant)
  two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  two_factor_secret VARCHAR(255),
  two_factor_backup_codes TEXT[], -- Encrypted backup codes
  
  -- Status
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ,
  
  -- Approval limits
  approval_limit_cents BIGINT DEFAULT 0, -- 0 = no approval authority
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for auth lookup
CREATE INDEX idx_users_auth_user_id ON users(auth_user_id);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_email ON users(email);

-- -----------------------------------------------------------------------------
-- 2. COMPANY SETTINGS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE company_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name VARCHAR(255) NOT NULL,
  legal_name VARCHAR(255),
  
  -- Address
  address_line1 VARCHAR(255),
  address_line2 VARCHAR(255),
  city VARCHAR(100),
  province canadian_province,
  postal_code VARCHAR(10),
  
  -- Tax registration
  gst_hst_number VARCHAR(20),
  qst_number VARCHAR(20),
  
  -- Banking for EFT
  bank_name VARCHAR(100),
  bank_transit_number VARCHAR(5),
  bank_institution_number VARCHAR(3),
  bank_account_number VARCHAR(12),
  
  -- Branding
  logo_url TEXT,
  primary_color VARCHAR(7) DEFAULT '#1a1a1a',
  
  -- Holdback settings (Builder's Lien Act)
  default_holdback_percentage DECIMAL(5,2) NOT NULL DEFAULT 10.00,
  holdback_release_days INTEGER NOT NULL DEFAULT 45,
  
  -- Approval thresholds (in cents to avoid floating point issues)
  tier1_threshold_cents BIGINT NOT NULL DEFAULT 100000,   -- $1,000
  tier2_threshold_cents BIGINT NOT NULL DEFAULT 1000000,  -- $10,000
  
  -- QuickBooks integration
  qb_realm_id VARCHAR(50),
  qb_access_token TEXT,
  qb_refresh_token TEXT,
  qb_token_expires_at TIMESTAMPTZ,
  
  -- Notification settings
  whatsapp_enabled BOOLEAN DEFAULT FALSE,
  twilio_account_sid VARCHAR(50),
  twilio_auth_token VARCHAR(100),
  twilio_whatsapp_number VARCHAR(20),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 3. CONTRACTORS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE contractors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Auth link (for vendor portal access)
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Basic info
  company_name VARCHAR(255) NOT NULL,
  contact_name VARCHAR(200),
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  
  -- Address
  address_line1 VARCHAR(255),
  address_line2 VARCHAR(255),
  city VARCHAR(100),
  province canadian_province NOT NULL,
  postal_code VARCHAR(10),
  
  -- Tax info for T5018
  business_number VARCHAR(15), -- CRA business number
  is_corporation BOOLEAN DEFAULT FALSE,
  
  -- Banking for EFT payments
  bank_name VARCHAR(100),
  bank_transit_number VARCHAR(5),
  bank_institution_number VARCHAR(3),
  bank_account_number VARCHAR(12),
  
  -- Compliance tracking
  wcb_account_number VARCHAR(20),
  wcb_clearance_expiry DATE,
  wcb_clearance_document_url TEXT,
  
  -- Status
  status contractor_status NOT NULL DEFAULT 'pending_kyc',
  kyc_completed_at TIMESTAMPTZ,
  
  -- QuickBooks sync
  qb_vendor_id VARCHAR(50),
  qb_synced_at TIMESTAMPTZ,
  
  -- Metadata
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_contractors_status ON contractors(status);
CREATE INDEX idx_contractors_province ON contractors(province);
CREATE INDEX idx_contractors_wcb_expiry ON contractors(wcb_clearance_expiry);
CREATE INDEX idx_contractors_email ON contractors(email);

-- -----------------------------------------------------------------------------
-- 4. VENDOR KYC DOCUMENTS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE vendor_kyc_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  
  document_type kyc_document_type NOT NULL,
  document_url TEXT NOT NULL,
  file_name VARCHAR(255),
  file_size_bytes BIGINT,
  mime_type VARCHAR(100),
  
  -- Verification
  status kyc_document_status NOT NULL DEFAULT 'pending',
  verified_by UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  rejection_reason TEXT,
  
  -- Expiry tracking
  expiry_date DATE,
  
  -- Metadata extracted from document
  extracted_data JSONB,
  
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kyc_docs_contractor ON vendor_kyc_documents(contractor_id);
CREATE INDEX idx_kyc_docs_status ON vendor_kyc_documents(status);
CREATE INDEX idx_kyc_docs_type ON vendor_kyc_documents(document_type);
CREATE INDEX idx_kyc_docs_expiry ON vendor_kyc_documents(expiry_date);

-- -----------------------------------------------------------------------------
-- 5. PROJECTS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  project_number VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  
  -- Location
  address_line1 VARCHAR(255),
  city VARCHAR(100),
  province canadian_province,
  
  -- Budget (in cents)
  original_budget_cents BIGINT NOT NULL DEFAULT 0,
  current_budget_cents BIGINT NOT NULL DEFAULT 0, -- Includes approved COs
  spent_cents BIGINT NOT NULL DEFAULT 0,
  committed_cents BIGINT NOT NULL DEFAULT 0, -- Approved but not paid
  
  -- Dates
  start_date DATE,
  estimated_completion_date DATE,
  actual_completion_date DATE,
  substantial_performance_date DATE, -- Triggers holdback countdown
  
  -- Status
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  
  -- QuickBooks
  qb_class_id VARCHAR(50),
  qb_synced_at TIMESTAMPTZ,
  
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_projects_number ON projects(project_number);
CREATE INDEX idx_projects_active ON projects(is_active);
CREATE INDEX idx_projects_substantial_perf ON projects(substantial_performance_date);

-- -----------------------------------------------------------------------------
-- 6. BUDGET THRESHOLDS TABLE (Project-specific alert thresholds)
-- -----------------------------------------------------------------------------
CREATE TABLE budget_thresholds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  
  -- Threshold as percentage of budget
  warning_threshold_percent DECIMAL(5,2) NOT NULL DEFAULT 80.00,
  critical_threshold_percent DECIMAL(5,2) NOT NULL DEFAULT 95.00,
  
  -- Or absolute amounts (in cents)
  warning_amount_cents BIGINT,
  critical_amount_cents BIGINT,
  
  -- Notification recipients
  notify_user_ids UUID[] DEFAULT '{}',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(project_id)
);

-- -----------------------------------------------------------------------------
-- 7. CHANGE ORDERS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE change_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contractor_id UUID REFERENCES contractors(id),
  
  co_number VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  
  -- Amount (in cents) - can be positive or negative
  amount_cents BIGINT NOT NULL,
  
  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'approved', 'rejected')),
  
  -- Approval
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  
  -- Documentation
  document_urls TEXT[],
  
  -- QuickBooks
  qb_estimate_id VARCHAR(50),
  
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(project_id, co_number)
);

CREATE INDEX idx_change_orders_project ON change_orders(project_id);
CREATE INDEX idx_change_orders_status ON change_orders(status);

-- -----------------------------------------------------------------------------
-- 8. INVOICES TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contractor_id UUID NOT NULL REFERENCES contractors(id),
  project_id UUID REFERENCES projects(id),
  change_order_id UUID REFERENCES change_orders(id),
  
  -- Invoice details
  invoice_number VARCHAR(100) NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE,
  
  -- Amounts (all in cents)
  subtotal_cents BIGINT NOT NULL,
  
  -- Dynamic tax calculation based on contractor province
  gst_hst_rate DECIMAL(5,4) DEFAULT 0,
  gst_hst_cents BIGINT DEFAULT 0,
  pst_rate DECIMAL(5,4) DEFAULT 0,
  pst_cents BIGINT DEFAULT 0,
  qst_rate DECIMAL(5,4) DEFAULT 0,
  qst_cents BIGINT DEFAULT 0,
  
  total_cents BIGINT NOT NULL,
  
  -- Holdback calculation
  holdback_percent DECIMAL(5,2) DEFAULT 10.00,
  holdback_cents BIGINT DEFAULT 0,
  net_payable_cents BIGINT NOT NULL, -- total - holdback
  
  -- Progressive billing tracking
  amount_paid_cents BIGINT NOT NULL DEFAULT 0,
  amount_remaining_cents BIGINT NOT NULL,
  
  -- Status
  status invoice_status NOT NULL DEFAULT 'draft',
  
  -- Source tracking
  source VARCHAR(50) DEFAULT 'manual' 
    CHECK (source IN ('manual', 'vendor_portal', 'api', 'ocr')),
  
  -- OCR data
  ocr_confidence_score DECIMAL(5,2),
  ocr_raw_data JSONB,
  
  -- Document storage
  document_url TEXT,
  
  -- QuickBooks
  qb_bill_id VARCHAR(50),
  qb_synced_at TIMESTAMPTZ,
  
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(contractor_id, invoice_number)
);

CREATE INDEX idx_invoices_contractor ON invoices(contractor_id);
CREATE INDEX idx_invoices_project ON invoices(project_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_date ON invoices(invoice_date);
CREATE INDEX idx_invoices_number ON invoices(invoice_number);

-- -----------------------------------------------------------------------------
-- 9. PAYMENT REQUESTS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE payment_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  contractor_id UUID NOT NULL REFERENCES contractors(id),
  project_id UUID REFERENCES projects(id),
  
  -- Request details
  request_number VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  
  -- Amount requested (in cents)
  requested_amount_cents BIGINT NOT NULL,
  approved_amount_cents BIGINT, -- May differ if short-pay
  
  -- Workflow status
  status payment_request_status NOT NULL DEFAULT 'ingested',
  current_approval_tier approval_tier,
  
  -- Flags
  requires_variance_explanation BOOLEAN DEFAULT FALSE,
  variance_explanation TEXT,
  is_anomaly_flagged BOOLEAN DEFAULT FALSE,
  
  -- Stat Dec requirement
  requires_stat_dec BOOLEAN DEFAULT FALSE,
  stat_dec_signed_at TIMESTAMPTZ,
  
  -- Processing
  processed_by UUID REFERENCES users(id),
  processed_at TIMESTAMPTZ,
  payment_method payment_method,
  payment_reference VARCHAR(100),
  
  -- QuickBooks
  qb_payment_id VARCHAR(50),
  qb_synced_at TIMESTAMPTZ,
  
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_requests_invoice ON payment_requests(invoice_id);
CREATE INDEX idx_payment_requests_contractor ON payment_requests(contractor_id);
CREATE INDEX idx_payment_requests_status ON payment_requests(status);
CREATE INDEX idx_payment_requests_tier ON payment_requests(current_approval_tier);

-- -----------------------------------------------------------------------------
-- 10. APPROVALS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_request_id UUID NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
  
  -- Approval details
  tier approval_tier NOT NULL,
  approver_id UUID NOT NULL REFERENCES users(id),
  
  -- Decision
  decision approval_decision NOT NULL DEFAULT 'pending',
  decision_at TIMESTAMPTZ,
  
  -- For short-pay
  original_amount_cents BIGINT NOT NULL,
  approved_amount_cents BIGINT,
  short_pay_reason TEXT,
  short_pay_evidence_url TEXT,
  
  -- Comments
  comments TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_approvals_request ON approvals(payment_request_id);
CREATE INDEX idx_approvals_approver ON approvals(approver_id);
CREATE INDEX idx_approvals_decision ON approvals(decision);

-- -----------------------------------------------------------------------------
-- 11. DISPUTES TABLE (Short-pay tracking)
-- -----------------------------------------------------------------------------
CREATE TABLE disputes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_request_id UUID NOT NULL REFERENCES payment_requests(id),
  approval_id UUID REFERENCES approvals(id),
  contractor_id UUID NOT NULL REFERENCES contractors(id),
  
  -- Dispute details
  original_amount_cents BIGINT NOT NULL,
  paid_amount_cents BIGINT NOT NULL,
  disputed_amount_cents BIGINT NOT NULL,
  
  -- Reason and evidence
  dispute_reason TEXT NOT NULL,
  evidence_urls TEXT[],
  
  -- Resolution
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'credited', 'written_off')),
  resolution_notes TEXT,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  
  -- If credited back
  credit_note_number VARCHAR(50),
  credit_amount_cents BIGINT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_disputes_request ON disputes(payment_request_id);
CREATE INDEX idx_disputes_contractor ON disputes(contractor_id);
CREATE INDEX idx_disputes_status ON disputes(status);

-- -----------------------------------------------------------------------------
-- 12. LIEN WAIVERS (STATUTORY DECLARATIONS) TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE lien_waivers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_request_id UUID NOT NULL REFERENCES payment_requests(id),
  contractor_id UUID NOT NULL REFERENCES contractors(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  
  -- Waiver details
  waiver_type VARCHAR(50) NOT NULL DEFAULT 'progress'
    CHECK (waiver_type IN ('progress', 'final', 'conditional', 'unconditional')),
  
  -- Amount covered
  amount_cents BIGINT NOT NULL,
  
  -- Document
  document_url TEXT,
  document_hash VARCHAR(64), -- SHA-256 for integrity
  
  -- E-signature
  is_signed BOOLEAN NOT NULL DEFAULT FALSE,
  signed_at TIMESTAMPTZ,
  signer_ip_address INET,
  signer_user_agent TEXT,
  signature_data TEXT, -- Base64 signature image or e-sign token
  
  -- Validity
  valid_through_date DATE NOT NULL,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lien_waivers_request ON lien_waivers(payment_request_id);
CREATE INDEX idx_lien_waivers_contractor ON lien_waivers(contractor_id);
CREATE INDEX idx_lien_waivers_signed ON lien_waivers(is_signed);

-- -----------------------------------------------------------------------------
-- 13. HOLDBACK LEDGERS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE holdback_ledgers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contractor_id UUID NOT NULL REFERENCES contractors(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  invoice_id UUID REFERENCES invoices(id),
  payment_request_id UUID REFERENCES payment_requests(id),
  
  -- Holdback details
  holdback_amount_cents BIGINT NOT NULL,
  holdback_percent DECIMAL(5,2) NOT NULL,
  
  -- Status and countdown
  status holdback_status NOT NULL DEFAULT 'withheld',
  
  -- Builder's Lien Act countdown
  countdown_start_date DATE, -- Usually substantial performance date
  release_due_date DATE, -- countdown_start + holdback_release_days
  
  -- Release info
  released_amount_cents BIGINT DEFAULT 0,
  released_at TIMESTAMPTZ,
  released_by UUID REFERENCES users(id),
  release_payment_request_id UUID REFERENCES payment_requests(id),
  
  -- QuickBooks
  qb_journal_entry_id VARCHAR(50),
  
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_holdback_contractor ON holdback_ledgers(contractor_id);
CREATE INDEX idx_holdback_project ON holdback_ledgers(project_id);
CREATE INDEX idx_holdback_status ON holdback_ledgers(status);
CREATE INDEX idx_holdback_release_date ON holdback_ledgers(release_due_date);

-- -----------------------------------------------------------------------------
-- 14. PAYMENTS TABLE (Actual payment records)
-- -----------------------------------------------------------------------------
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_request_id UUID NOT NULL REFERENCES payment_requests(id),
  contractor_id UUID NOT NULL REFERENCES contractors(id),
  
  -- Payment details
  amount_cents BIGINT NOT NULL,
  payment_method payment_method NOT NULL,
  payment_date DATE NOT NULL,
  
  -- Bank file reference
  eft_file_id VARCHAR(100),
  eft_file_sequence INTEGER,
  
  -- Reference numbers
  cheque_number VARCHAR(20),
  etransfer_reference VARCHAR(50),
  wire_reference VARCHAR(50),
  
  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'cleared', 'returned', 'cancelled')),
  cleared_date DATE,
  
  -- QuickBooks
  qb_payment_id VARCHAR(50),
  qb_synced_at TIMESTAMPTZ,
  
  processed_by UUID NOT NULL REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_request ON payments(payment_request_id);
CREATE INDEX idx_payments_contractor ON payments(contractor_id);
CREATE INDEX idx_payments_date ON payments(payment_date);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_eft_file ON payments(eft_file_id);

-- -----------------------------------------------------------------------------
-- 15. ANOMALY FLAGS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE anomaly_flags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Can be linked to various entities
  invoice_id UUID REFERENCES invoices(id),
  payment_request_id UUID REFERENCES payment_requests(id),
  contractor_id UUID REFERENCES contractors(id),
  
  -- Anomaly details
  anomaly_type anomaly_type NOT NULL,
  severity anomaly_severity NOT NULL DEFAULT 'medium',
  
  -- Description and evidence
  description TEXT NOT NULL,
  details JSONB, -- Structured data about the anomaly
  
  -- Resolution
  is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolution_action VARCHAR(50)
    CHECK (resolution_action IN ('approved', 'rejected', 'modified', 'ignored')),
  resolution_notes TEXT,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_anomaly_invoice ON anomaly_flags(invoice_id);
CREATE INDEX idx_anomaly_request ON anomaly_flags(payment_request_id);
CREATE INDEX idx_anomaly_type ON anomaly_flags(anomaly_type);
CREATE INDEX idx_anomaly_resolved ON anomaly_flags(is_resolved);
CREATE INDEX idx_anomaly_severity ON anomaly_flags(severity);

-- -----------------------------------------------------------------------------
-- 16. QUICKBOOKS SYNC LOGS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE quickbooks_sync_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Entity being synced
  entity_type VARCHAR(50) NOT NULL
    CHECK (entity_type IN ('contractor', 'invoice', 'payment', 'holdback', 'project')),
  entity_id UUID NOT NULL,
  
  -- Sync details
  sync_direction VARCHAR(10) NOT NULL CHECK (sync_direction IN ('push', 'pull')),
  qb_entity_id VARCHAR(50),
  
  -- Status
  status qb_sync_status NOT NULL DEFAULT 'pending',
  error_message TEXT,
  error_code VARCHAR(50),
  
  -- Request/response logging
  request_payload JSONB,
  response_payload JSONB,
  
  synced_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_qb_sync_entity ON quickbooks_sync_logs(entity_type, entity_id);
CREATE INDEX idx_qb_sync_status ON quickbooks_sync_logs(status);
CREATE INDEX idx_qb_sync_date ON quickbooks_sync_logs(created_at);

-- -----------------------------------------------------------------------------
-- 17. AUDIT LOGS TABLE (Immutable)
-- -----------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Who
  user_id UUID REFERENCES users(id),
  user_email VARCHAR(255),
  user_role user_role,
  
  -- What
  action audit_action NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID,
  
  -- Details
  description TEXT NOT NULL,
  old_values JSONB,
  new_values JSONB,
  
  -- Context
  ip_address INET,
  user_agent TEXT,
  
  -- Timestamp (immutable - no updated_at)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Make audit_logs append-only (no updates or deletes)
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_date ON audit_logs(created_at);

-- -----------------------------------------------------------------------------
-- 18. CANADIAN TAX RATES TABLE (Reference data)
-- -----------------------------------------------------------------------------
CREATE TABLE canadian_tax_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  province canadian_province NOT NULL UNIQUE,
  province_name VARCHAR(100) NOT NULL,
  
  -- GST/HST
  gst_rate DECIMAL(5,4) NOT NULL DEFAULT 0.05, -- 5% federal GST
  hst_rate DECIMAL(5,4) DEFAULT 0, -- Combined HST (replaces GST+PST)
  
  -- Provincial taxes
  pst_rate DECIMAL(5,4) DEFAULT 0,
  qst_rate DECIMAL(5,4) DEFAULT 0, -- Quebec only
  
  -- Flags
  uses_hst BOOLEAN NOT NULL DEFAULT FALSE,
  uses_qst BOOLEAN NOT NULL DEFAULT FALSE,
  
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- ROW LEVEL SECURITY POLICIES
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE contractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_kyc_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE lien_waivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE holdback_ledgers ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE anomaly_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE quickbooks_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE canadian_tax_rates ENABLE ROW LEVEL SECURITY;

-- Helper function to get user role
CREATE OR REPLACE FUNCTION get_user_role(auth_uid UUID)
RETURNS user_role AS $$
  SELECT role FROM users WHERE auth_user_id = auth_uid LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER;

-- Helper function to check if user is internal (not contractor)
CREATE OR REPLACE FUNCTION is_internal_user(auth_uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM users 
    WHERE auth_user_id = auth_uid 
    AND role IN ('admin', 'accountant', 'project_manager')
  );
$$ LANGUAGE SQL SECURITY DEFINER;

-- Helper function to get contractor_id for contractor users
CREATE OR REPLACE FUNCTION get_contractor_id(auth_uid UUID)
RETURNS UUID AS $$
  SELECT id FROM contractors WHERE auth_user_id = auth_uid LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER;

-- USERS policies
CREATE POLICY "users_select_own" ON users 
  FOR SELECT USING (auth.uid() = auth_user_id OR is_internal_user(auth.uid()));

CREATE POLICY "users_insert_admin" ON users 
  FOR INSERT WITH CHECK (get_user_role(auth.uid()) = 'admin');

CREATE POLICY "users_update_admin_or_self" ON users 
  FOR UPDATE USING (
    auth.uid() = auth_user_id OR get_user_role(auth.uid()) = 'admin'
  );

-- COMPANY SETTINGS policies (admin only for write, all internal can read)
CREATE POLICY "company_settings_select" ON company_settings 
  FOR SELECT USING (is_internal_user(auth.uid()));

CREATE POLICY "company_settings_all_admin" ON company_settings 
  FOR ALL USING (get_user_role(auth.uid()) = 'admin');

-- CONTRACTORS policies
CREATE POLICY "contractors_select_internal" ON contractors 
  FOR SELECT USING (is_internal_user(auth.uid()) OR auth_user_id = auth.uid());

CREATE POLICY "contractors_insert_internal" ON contractors 
  FOR INSERT WITH CHECK (is_internal_user(auth.uid()));

CREATE POLICY "contractors_update" ON contractors 
  FOR UPDATE USING (
    is_internal_user(auth.uid()) OR auth_user_id = auth.uid()
  );

-- KYC DOCUMENTS policies
CREATE POLICY "kyc_docs_select" ON vendor_kyc_documents 
  FOR SELECT USING (
    is_internal_user(auth.uid()) OR 
    contractor_id = get_contractor_id(auth.uid())
  );

CREATE POLICY "kyc_docs_insert" ON vendor_kyc_documents 
  FOR INSERT WITH CHECK (
    is_internal_user(auth.uid()) OR 
    contractor_id = get_contractor_id(auth.uid())
  );

CREATE POLICY "kyc_docs_update_internal" ON vendor_kyc_documents 
  FOR UPDATE USING (is_internal_user(auth.uid()));

-- PROJECTS policies (internal users only)
CREATE POLICY "projects_select" ON projects 
  FOR SELECT USING (is_internal_user(auth.uid()));

CREATE POLICY "projects_insert" ON projects 
  FOR INSERT WITH CHECK (is_internal_user(auth.uid()));

CREATE POLICY "projects_update" ON projects 
  FOR UPDATE USING (is_internal_user(auth.uid()));

-- BUDGET THRESHOLDS policies
CREATE POLICY "budget_thresholds_all" ON budget_thresholds 
  FOR ALL USING (is_internal_user(auth.uid()));

-- CHANGE ORDERS policies
CREATE POLICY "change_orders_select" ON change_orders 
  FOR SELECT USING (is_internal_user(auth.uid()));

CREATE POLICY "change_orders_insert" ON change_orders 
  FOR INSERT WITH CHECK (is_internal_user(auth.uid()));

CREATE POLICY "change_orders_update" ON change_orders 
  FOR UPDATE USING (is_internal_user(auth.uid()));

-- INVOICES policies
CREATE POLICY "invoices_select" ON invoices 
  FOR SELECT USING (
    is_internal_user(auth.uid()) OR 
    contractor_id = get_contractor_id(auth.uid())
  );

CREATE POLICY "invoices_insert" ON invoices 
  FOR INSERT WITH CHECK (
    is_internal_user(auth.uid()) OR 
    contractor_id = get_contractor_id(auth.uid())
  );

CREATE POLICY "invoices_update_internal" ON invoices 
  FOR UPDATE USING (is_internal_user(auth.uid()));

-- PAYMENT REQUESTS policies
CREATE POLICY "payment_requests_select" ON payment_requests 
  FOR SELECT USING (
    is_internal_user(auth.uid()) OR 
    contractor_id = get_contractor_id(auth.uid())
  );

CREATE POLICY "payment_requests_insert" ON payment_requests 
  FOR INSERT WITH CHECK (is_internal_user(auth.uid()));

CREATE POLICY "payment_requests_update" ON payment_requests 
  FOR UPDATE USING (is_internal_user(auth.uid()));

-- APPROVALS policies
CREATE POLICY "approvals_select" ON approvals 
  FOR SELECT USING (is_internal_user(auth.uid()));

CREATE POLICY "approvals_insert" ON approvals 
  FOR INSERT WITH CHECK (is_internal_user(auth.uid()));

CREATE POLICY "approvals_update" ON approvals 
  FOR UPDATE USING (
    is_internal_user(auth.uid()) AND 
    (approver_id = (SELECT id FROM users WHERE auth_user_id = auth.uid()) OR 
     get_user_role(auth.uid()) = 'admin')
  );

-- DISPUTES policies
CREATE POLICY "disputes_select" ON disputes 
  FOR SELECT USING (
    is_internal_user(auth.uid()) OR 
    contractor_id = get_contractor_id(auth.uid())
  );

CREATE POLICY "disputes_insert" ON disputes 
  FOR INSERT WITH CHECK (is_internal_user(auth.uid()));

CREATE POLICY "disputes_update" ON disputes 
  FOR UPDATE USING (is_internal_user(auth.uid()));

-- LIEN WAIVERS policies
CREATE POLICY "lien_waivers_select" ON lien_waivers 
  FOR SELECT USING (
    is_internal_user(auth.uid()) OR 
    contractor_id = get_contractor_id(auth.uid())
  );

CREATE POLICY "lien_waivers_insert" ON lien_waivers 
  FOR INSERT WITH CHECK (is_internal_user(auth.uid()));

CREATE POLICY "lien_waivers_update" ON lien_waivers 
  FOR UPDATE USING (
    is_internal_user(auth.uid()) OR 
    (contractor_id = get_contractor_id(auth.uid()) AND NOT is_signed)
  );

-- HOLDBACK LEDGERS policies
CREATE POLICY "holdback_ledgers_select" ON holdback_ledgers 
  FOR SELECT USING (
    is_internal_user(auth.uid()) OR 
    contractor_id = get_contractor_id(auth.uid())
  );

CREATE POLICY "holdback_ledgers_insert" ON holdback_ledgers 
  FOR INSERT WITH CHECK (is_internal_user(auth.uid()));

CREATE POLICY "holdback_ledgers_update" ON holdback_ledgers 
  FOR UPDATE USING (is_internal_user(auth.uid()));

-- PAYMENTS policies
CREATE POLICY "payments_select" ON payments 
  FOR SELECT USING (
    is_internal_user(auth.uid()) OR 
    contractor_id = get_contractor_id(auth.uid())
  );

CREATE POLICY "payments_insert" ON payments 
  FOR INSERT WITH CHECK (
    get_user_role(auth.uid()) IN ('admin', 'accountant')
  );

CREATE POLICY "payments_update" ON payments 
  FOR UPDATE USING (
    get_user_role(auth.uid()) IN ('admin', 'accountant')
  );

-- ANOMALY FLAGS policies
CREATE POLICY "anomaly_flags_all" ON anomaly_flags 
  FOR ALL USING (is_internal_user(auth.uid()));

-- QUICKBOOKS SYNC LOGS policies
CREATE POLICY "qb_sync_logs_all" ON quickbooks_sync_logs 
  FOR ALL USING (
    get_user_role(auth.uid()) IN ('admin', 'accountant')
  );

-- AUDIT LOGS policies (read-only for admin/accountant)
CREATE POLICY "audit_logs_select" ON audit_logs 
  FOR SELECT USING (
    get_user_role(auth.uid()) IN ('admin', 'accountant')
  );

CREATE POLICY "audit_logs_insert" ON audit_logs 
  FOR INSERT WITH CHECK (TRUE); -- Allow all inserts (controlled by application)

-- CANADIAN TAX RATES policies (read for all, write for admin)
CREATE POLICY "tax_rates_select" ON canadian_tax_rates 
  FOR SELECT USING (TRUE);

CREATE POLICY "tax_rates_write" ON canadian_tax_rates 
  FOR ALL USING (get_user_role(auth.uid()) = 'admin');

-- =============================================================================
-- TRIGGERS & FUNCTIONS
-- =============================================================================

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to all tables with updated_at column
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN 
    SELECT table_name 
    FROM information_schema.columns 
    WHERE column_name = 'updated_at' 
    AND table_schema = 'public'
  LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS update_%I_updated_at ON %I;
      CREATE TRIGGER update_%I_updated_at
        BEFORE UPDATE ON %I
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    ', t, t, t, t);
  END LOOP;
END;
$$;

-- Function to calculate Canadian taxes
CREATE OR REPLACE FUNCTION calculate_canadian_taxes(
  p_subtotal_cents BIGINT,
  p_contractor_province canadian_province
)
RETURNS TABLE (
  gst_hst_rate DECIMAL(5,4),
  gst_hst_cents BIGINT,
  pst_rate DECIMAL(5,4),
  pst_cents BIGINT,
  qst_rate DECIMAL(5,4),
  qst_cents BIGINT,
  total_tax_cents BIGINT
) AS $$
DECLARE
  v_tax_rate RECORD;
BEGIN
  SELECT * INTO v_tax_rate 
  FROM canadian_tax_rates 
  WHERE province = p_contractor_province;
  
  IF v_tax_rate IS NULL THEN
    -- Default to 5% GST if province not found
    RETURN QUERY SELECT 
      0.05::DECIMAL(5,4),
      (p_subtotal_cents * 0.05)::BIGINT,
      0::DECIMAL(5,4),
      0::BIGINT,
      0::DECIMAL(5,4),
      0::BIGINT,
      (p_subtotal_cents * 0.05)::BIGINT;
    RETURN;
  END IF;
  
  IF v_tax_rate.uses_hst THEN
    -- HST provinces (ON, NB, NL, NS, PE)
    RETURN QUERY SELECT 
      v_tax_rate.hst_rate,
      (p_subtotal_cents * v_tax_rate.hst_rate)::BIGINT,
      0::DECIMAL(5,4),
      0::BIGINT,
      0::DECIMAL(5,4),
      0::BIGINT,
      (p_subtotal_cents * v_tax_rate.hst_rate)::BIGINT;
  ELSIF v_tax_rate.uses_qst THEN
    -- Quebec (GST + QST)
    RETURN QUERY SELECT 
      v_tax_rate.gst_rate,
      (p_subtotal_cents * v_tax_rate.gst_rate)::BIGINT,
      0::DECIMAL(5,4),
      0::BIGINT,
      v_tax_rate.qst_rate,
      (p_subtotal_cents * v_tax_rate.qst_rate)::BIGINT,
      (p_subtotal_cents * (v_tax_rate.gst_rate + v_tax_rate.qst_rate))::BIGINT;
  ELSE
    -- GST + PST provinces (BC, SK, MB)
    RETURN QUERY SELECT 
      v_tax_rate.gst_rate,
      (p_subtotal_cents * v_tax_rate.gst_rate)::BIGINT,
      v_tax_rate.pst_rate,
      (p_subtotal_cents * v_tax_rate.pst_rate)::BIGINT,
      0::DECIMAL(5,4),
      0::BIGINT,
      (p_subtotal_cents * (v_tax_rate.gst_rate + v_tax_rate.pst_rate))::BIGINT;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to determine approval tier
CREATE OR REPLACE FUNCTION get_approval_tier(p_amount_cents BIGINT)
RETURNS approval_tier AS $$
DECLARE
  v_settings RECORD;
BEGIN
  SELECT tier1_threshold_cents, tier2_threshold_cents 
  INTO v_settings 
  FROM company_settings 
  LIMIT 1;
  
  -- Default thresholds if no settings
  IF v_settings IS NULL THEN
    v_settings.tier1_threshold_cents := 100000;  -- $1,000
    v_settings.tier2_threshold_cents := 1000000; -- $10,000
  END IF;
  
  IF p_amount_cents < v_settings.tier1_threshold_cents THEN
    RETURN 'project_manager';
  ELSIF p_amount_cents < v_settings.tier2_threshold_cents THEN
    RETURN 'general_manager';
  ELSE
    RETURN 'admin';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to check if holdback should be released
CREATE OR REPLACE FUNCTION check_holdback_release()
RETURNS TRIGGER AS $$
BEGIN
  -- When substantial_performance_date is set on a project,
  -- update all related holdback entries
  IF NEW.substantial_performance_date IS NOT NULL 
     AND OLD.substantial_performance_date IS NULL THEN
    UPDATE holdback_ledgers
    SET 
      status = 'countdown_started',
      countdown_start_date = NEW.substantial_performance_date,
      release_due_date = NEW.substantial_performance_date + 
        (SELECT holdback_release_days FROM company_settings LIMIT 1)::INTEGER
    WHERE project_id = NEW.id
    AND status = 'withheld';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_substantial_performance_trigger
  AFTER UPDATE OF substantial_performance_date ON projects
  FOR EACH ROW
  EXECUTE FUNCTION check_holdback_release();

-- Function to update project budget when change order approved
CREATE OR REPLACE FUNCTION update_project_budget_on_co()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
    UPDATE projects
    SET current_budget_cents = current_budget_cents + NEW.amount_cents
    WHERE id = NEW.project_id;
  ELSIF OLD.status = 'approved' AND NEW.status != 'approved' THEN
    -- Reverse if unapproved
    UPDATE projects
    SET current_budget_cents = current_budget_cents - OLD.amount_cents
    WHERE id = NEW.project_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER change_order_budget_trigger
  AFTER UPDATE OF status ON change_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_project_budget_on_co();

-- Function to create audit log entry
CREATE OR REPLACE FUNCTION create_audit_log(
  p_user_id UUID,
  p_action audit_action,
  p_entity_type VARCHAR(50),
  p_entity_id UUID,
  p_description TEXT,
  p_old_values JSONB DEFAULT NULL,
  p_new_values JSONB DEFAULT NULL,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_user RECORD;
  v_log_id UUID;
BEGIN
  SELECT email, role INTO v_user 
  FROM users 
  WHERE id = p_user_id OR auth_user_id = p_user_id
  LIMIT 1;
  
  INSERT INTO audit_logs (
    user_id, user_email, user_role, action, entity_type, entity_id,
    description, old_values, new_values, ip_address, user_agent
  ) VALUES (
    p_user_id, v_user.email, v_user.role, p_action, p_entity_type, p_entity_id,
    p_description, p_old_values, p_new_values, p_ip_address, p_user_agent
  )
  RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- SEED DATA: Canadian Tax Rates
-- =============================================================================

INSERT INTO canadian_tax_rates (province, province_name, gst_rate, hst_rate, pst_rate, qst_rate, uses_hst, uses_qst) VALUES
  ('AB', 'Alberta', 0.05, 0, 0, 0, FALSE, FALSE),
  ('BC', 'British Columbia', 0.05, 0, 0.07, 0, FALSE, FALSE),
  ('MB', 'Manitoba', 0.05, 0, 0.07, 0, FALSE, FALSE),
  ('NB', 'New Brunswick', 0, 0.15, 0, 0, TRUE, FALSE),
  ('NL', 'Newfoundland and Labrador', 0, 0.15, 0, 0, TRUE, FALSE),
  ('NS', 'Nova Scotia', 0, 0.15, 0, 0, TRUE, FALSE),
  ('NT', 'Northwest Territories', 0.05, 0, 0, 0, FALSE, FALSE),
  ('NU', 'Nunavut', 0.05, 0, 0, 0, FALSE, FALSE),
  ('ON', 'Ontario', 0, 0.13, 0, 0, TRUE, FALSE),
  ('PE', 'Prince Edward Island', 0, 0.15, 0, 0, TRUE, FALSE),
  ('QC', 'Quebec', 0.05, 0, 0, 0.09975, FALSE, TRUE),
  ('SK', 'Saskatchewan', 0.05, 0, 0.06, 0, FALSE, FALSE),
  ('YT', 'Yukon', 0.05, 0, 0, 0, FALSE, FALSE)
ON CONFLICT (province) DO UPDATE SET
  province_name = EXCLUDED.province_name,
  gst_rate = EXCLUDED.gst_rate,
  hst_rate = EXCLUDED.hst_rate,
  pst_rate = EXCLUDED.pst_rate,
  qst_rate = EXCLUDED.qst_rate,
  uses_hst = EXCLUDED.uses_hst,
  uses_qst = EXCLUDED.uses_qst;

-- =============================================================================
-- SEED DATA: Default Company Settings
-- =============================================================================

INSERT INTO company_settings (
  company_name,
  default_holdback_percentage,
  holdback_release_days,
  tier1_threshold_cents,
  tier2_threshold_cents
) VALUES (
  'Your Company Name',
  10.00,
  45,
  100000,   -- $1,000
  1000000   -- $10,000
) ON CONFLICT DO NOTHING;

-- =============================================================================
-- VIEWS FOR COMMON QUERIES
-- =============================================================================

-- View: Contractor compliance status
CREATE OR REPLACE VIEW v_contractor_compliance AS
SELECT 
  c.id,
  c.company_name,
  c.status,
  c.wcb_clearance_expiry,
  CASE 
    WHEN c.wcb_clearance_expiry IS NULL THEN 'missing'
    WHEN c.wcb_clearance_expiry < CURRENT_DATE THEN 'expired'
    WHEN c.wcb_clearance_expiry < CURRENT_DATE + INTERVAL '30 days' THEN 'expiring_soon'
    ELSE 'valid'
  END AS wcb_status,
  (SELECT COUNT(*) FROM vendor_kyc_documents WHERE contractor_id = c.id AND status = 'verified') AS verified_docs_count,
  (SELECT COUNT(*) FROM vendor_kyc_documents WHERE contractor_id = c.id AND status = 'pending') AS pending_docs_count
FROM contractors c;

-- View: Project budget summary
CREATE OR REPLACE VIEW v_project_budget_summary AS
SELECT 
  p.id,
  p.project_number,
  p.name,
  p.original_budget_cents,
  p.current_budget_cents,
  p.spent_cents,
  p.committed_cents,
  p.current_budget_cents - p.spent_cents - p.committed_cents AS available_cents,
  CASE 
    WHEN p.current_budget_cents > 0 
    THEN ROUND((p.spent_cents::DECIMAL / p.current_budget_cents) * 100, 2)
    ELSE 0
  END AS spent_percentage,
  (SELECT COALESCE(SUM(amount_cents), 0) FROM change_orders WHERE project_id = p.id AND status = 'approved') AS approved_cos_cents
FROM projects p
WHERE p.is_active = TRUE;

-- View: Pending approvals by tier
CREATE OR REPLACE VIEW v_pending_approvals AS
SELECT 
  pr.id AS payment_request_id,
  pr.request_number,
  pr.requested_amount_cents,
  pr.current_approval_tier,
  pr.status,
  c.company_name AS contractor_name,
  p.project_number,
  p.name AS project_name,
  i.invoice_number,
  pr.created_at
FROM payment_requests pr
JOIN contractors c ON pr.contractor_id = c.id
LEFT JOIN projects p ON pr.project_id = p.id
JOIN invoices i ON pr.invoice_id = i.id
WHERE pr.status IN ('pending', 'pending_approval')
ORDER BY pr.created_at ASC;

-- View: Holdbacks pending release
CREATE OR REPLACE VIEW v_holdbacks_pending_release AS
SELECT 
  h.id,
  h.holdback_amount_cents,
  h.countdown_start_date,
  h.release_due_date,
  h.release_due_date - CURRENT_DATE AS days_until_release,
  c.company_name AS contractor_name,
  p.project_number,
  p.name AS project_name
FROM holdback_ledgers h
JOIN contractors c ON h.contractor_id = c.id
JOIN projects p ON h.project_id = p.id
WHERE h.status = 'countdown_started'
AND h.release_due_date <= CURRENT_DATE + INTERVAL '7 days'
ORDER BY h.release_due_date ASC;

-- =============================================================================
-- SCHEMA COMPLETE
-- =============================================================================
