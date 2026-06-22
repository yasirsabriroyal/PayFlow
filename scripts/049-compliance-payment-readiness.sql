-- ============================================================
-- Migration 049 — Compliance & Payment Readiness Enforcement
-- Applied: 2026-06-21
-- ============================================================

-- 1. Add safety_certification to kyc_document_type enum
ALTER TYPE kyc_document_type ADD VALUE IF NOT EXISTS 'safety_certification';

-- 2. Add invoice_id to lien_waivers for direct invoice-level lien checks
ALTER TABLE lien_waivers
  ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lien_waivers_invoice_id
  ON lien_waivers(invoice_id)
  WHERE invoice_id IS NOT NULL;

-- 3. compliance_overrides table
CREATE TABLE IF NOT EXISTS compliance_overrides (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contractor_id     UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  invoice_id        UUID REFERENCES invoices(id) ON DELETE SET NULL,
  issue_type        TEXT NOT NULL,
  override_reason   TEXT NOT NULL CHECK (char_length(override_reason) >= 25),
  approved_by       UUID NOT NULL REFERENCES users(id),
  approved_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_overrides_contractor ON compliance_overrides(contractor_id);
CREATE INDEX IF NOT EXISTS idx_compliance_overrides_invoice ON compliance_overrides(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_compliance_overrides_active ON compliance_overrides(contractor_id, issue_type) WHERE is_active = TRUE;

ALTER TABLE compliance_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "compliance_overrides_select_internal" ON compliance_overrides FOR SELECT
  USING (EXISTS (SELECT 1 FROM users u WHERE u.auth_user_id = auth.uid() AND u.role IN ('admin','accountant','project_manager')));
CREATE POLICY "compliance_overrides_insert_internal" ON compliance_overrides FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM users u WHERE u.auth_user_id = auth.uid() AND u.role IN ('admin','accountant')));

-- 4. compliance_expiry_alerts deduplication table
CREATE TABLE IF NOT EXISTS compliance_expiry_alerts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id     UUID NOT NULL,
  document_type   TEXT NOT NULL,
  contractor_id   UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  alert_stage     TEXT NOT NULL,  -- 'expiring_30d','expiring_14d','expiring_7d','expiring_1d','expired'
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(document_id, alert_stage)
);

CREATE INDEX IF NOT EXISTS idx_compliance_expiry_alerts_doc ON compliance_expiry_alerts(document_id);
CREATE INDEX IF NOT EXISTS idx_compliance_expiry_alerts_contractor ON compliance_expiry_alerts(contractor_id);

-- 5. New audit_action enum values
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'payment_blocked_compliance';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'compliance_override_created';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'compliance_override_expired';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'compliance_document_expired';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'compliance_document_uploaded';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'compliance_document_approved';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'compliance_document_rejected';

-- 6. Seed system_settings
INSERT INTO system_settings (setting_key, setting_value, setting_type, description) VALUES
  ('require_safety_certification', '{"enabled": false}', 'compliance', 'Safety certification requirement'),
  ('require_lien_waiver_for_payment', '{"enabled": true}', 'compliance', 'Lien waiver requirement for all payments'),
  ('require_business_license', '{"enabled": true}', 'compliance', 'Business license verification requirement'),
  ('require_insurance_certificate', '{"enabled": true}', 'compliance', 'Insurance certificate verification requirement')
ON CONFLICT (setting_key) DO NOTHING;
