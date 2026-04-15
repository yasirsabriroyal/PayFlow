-- =====================================================
-- Admin Control Center - Database Schema Updates
-- =====================================================
-- This migration adds:
-- 1. system_settings table for payment guardrails and compliance rules
-- 2. report_templates table for saved custom reports
-- 3. team_invitations table for tracking invitations
-- =====================================================

-- =====================================================
-- 1. SYSTEM SETTINGS TABLE
-- =====================================================
-- Stores global payment guardrails and compliance configurations

CREATE TABLE IF NOT EXISTS public.system_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  setting_value JSONB NOT NULL DEFAULT '{}',
  setting_type VARCHAR(50) NOT NULL DEFAULT 'config', -- 'config', 'compliance', 'notification', 'integration'
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  updated_by uuid REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_system_settings_key ON public.system_settings(setting_key);
CREATE INDEX IF NOT EXISTS idx_system_settings_type ON public.system_settings(setting_type);

-- Enable RLS
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Only admins can manage system settings
CREATE POLICY "system_settings_select" ON public.system_settings
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u 
      WHERE u.auth_user_id = auth.uid() 
      AND u.role = 'admin'
    )
  );

CREATE POLICY "system_settings_all_admin" ON public.system_settings
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u 
      WHERE u.auth_user_id = auth.uid() 
      AND u.role = 'admin'
    )
  );

-- Insert default payment guardrails
INSERT INTO public.system_settings (setting_key, setting_value, setting_type, description) VALUES
  ('payment_wcb_block', '{"enabled": true, "description": "Block EFT generation if contractor WCB clearance is expired"}', 'compliance', 'WCB clearance verification requirement'),
  ('payment_lien_waiver_required', '{"enabled": true, "description": "Require signed lien waiver before holdback release"}', 'compliance', 'Lien waiver requirement for holdback release'),
  ('payment_stat_dec_threshold', '{"enabled": true, "threshold_cents": 5000000, "description": "Require statutory declaration for invoices exceeding threshold"}', 'compliance', 'Statutory declaration threshold (default $50,000)'),
  ('payment_approval_thresholds', '{"tier1_cents": 2500000, "tier2_cents": 10000000, "description": "Payment approval tier thresholds"}', 'config', 'Multi-tier approval thresholds'),
  ('holdback_default_percentage', '{"percentage": 10, "description": "Default statutory holdback percentage"}', 'config', 'Default holdback percentage'),
  ('holdback_release_days', '{"days": 45, "description": "Standard holdback release period in days"}', 'config', 'Holdback release countdown period')
ON CONFLICT (setting_key) DO NOTHING;

-- =====================================================
-- 2. REPORT TEMPLATES TABLE
-- =====================================================
-- Stores saved custom report configurations

CREATE TABLE IF NOT EXISTS public.report_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  dataset VARCHAR(50) NOT NULL, -- 'invoices', 'holdbacks', 'projects', 'payments', 'contractors'
  columns JSONB NOT NULL DEFAULT '[]', -- Array of column definitions
  filters JSONB DEFAULT '{}', -- Saved filter conditions
  sort_config JSONB DEFAULT '{}', -- Sort configuration
  created_by uuid REFERENCES public.users(id),
  is_shared BOOLEAN DEFAULT false, -- Whether template is shared with team
  is_system BOOLEAN DEFAULT false, -- System-default templates
  last_used_at TIMESTAMPTZ,
  use_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_report_templates_dataset ON public.report_templates(dataset);
CREATE INDEX IF NOT EXISTS idx_report_templates_created_by ON public.report_templates(created_by);

-- Enable RLS
ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "report_templates_select" ON public.report_templates
  FOR SELECT TO authenticated
  USING (
    is_shared = true 
    OR is_system = true 
    OR created_by IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "report_templates_insert" ON public.report_templates
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u 
      WHERE u.auth_user_id = auth.uid() 
      AND u.role IN ('admin', 'accountant')
    )
  );

CREATE POLICY "report_templates_update" ON public.report_templates
  FOR UPDATE TO authenticated
  USING (
    created_by IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.users u 
      WHERE u.auth_user_id = auth.uid() 
      AND u.role = 'admin'
    )
  );

CREATE POLICY "report_templates_delete" ON public.report_templates
  FOR DELETE TO authenticated
  USING (
    created_by IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.users u 
      WHERE u.auth_user_id = auth.uid() 
      AND u.role = 'admin'
    )
  );

-- Insert default report templates
INSERT INTO public.report_templates (name, description, dataset, columns, is_system, is_shared) VALUES
  ('All Invoices', 'Complete invoice listing with all details', 'invoices', 
   '["invoice_number", "contractor_name", "project_name", "invoice_date", "subtotal_cents", "gst_hst_cents", "total_cents", "holdback_cents", "net_payable_cents", "status"]', 
   true, true),
  ('Pending Holdbacks', 'Holdbacks pending release', 'holdbacks', 
   '["project_name", "contractor_name", "invoice_number", "holdback_amount_cents", "countdown_start_date", "release_due_date", "status"]', 
   true, true),
  ('Project Budget Summary', 'Budget utilization by project', 'projects', 
   '["project_number", "name", "original_budget_cents", "current_budget_cents", "spent_cents", "available_cents", "spent_percentage", "is_active"]', 
   true, true),
  ('Payment History', 'Completed payments listing', 'payments', 
   '["payment_date", "contractor_name", "project_name", "amount_cents", "payment_method", "status", "eft_file_id"]', 
   true, true),
  ('Contractor Directory', 'All contractors with compliance status', 'contractors', 
   '["company_name", "contact_name", "email", "phone", "wcb_status", "wcb_clearance_expiry", "status"]', 
   true, true)
ON CONFLICT DO NOTHING;

-- =====================================================
-- 3. TEAM INVITATIONS TABLE
-- =====================================================
-- Tracks pending team member invitations

CREATE TABLE IF NOT EXISTS public.team_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  role user_role NOT NULL DEFAULT 'project_manager',
  invited_by uuid REFERENCES public.users(id),
  invitation_token VARCHAR(255) UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  accepted_at TIMESTAMPTZ,
  created_user_id uuid REFERENCES public.users(id),
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'accepted', 'expired', 'cancelled'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_team_invitations_email ON public.team_invitations(email);
CREATE INDEX IF NOT EXISTS idx_team_invitations_token ON public.team_invitations(invitation_token);
CREATE INDEX IF NOT EXISTS idx_team_invitations_status ON public.team_invitations(status);

-- Enable RLS
ALTER TABLE public.team_invitations ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "team_invitations_select" ON public.team_invitations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u 
      WHERE u.auth_user_id = auth.uid() 
      AND u.role = 'admin'
    )
  );

CREATE POLICY "team_invitations_insert" ON public.team_invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u 
      WHERE u.auth_user_id = auth.uid() 
      AND u.role = 'admin'
    )
  );

CREATE POLICY "team_invitations_update" ON public.team_invitations
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u 
      WHERE u.auth_user_id = auth.uid() 
      AND u.role = 'admin'
    )
  );

-- =====================================================
-- 4. HELPER FUNCTIONS
-- =====================================================

-- Function to get a system setting value
CREATE OR REPLACE FUNCTION get_system_setting(p_key VARCHAR)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_value JSONB;
BEGIN
  SELECT setting_value INTO v_value
  FROM public.system_settings
  WHERE setting_key = p_key AND is_active = true;
  
  RETURN COALESCE(v_value, '{}'::JSONB);
END;
$$;

-- Function to update a system setting
CREATE OR REPLACE FUNCTION update_system_setting(
  p_key VARCHAR,
  p_value JSONB,
  p_user_id uuid
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.system_settings
  SET 
    setting_value = p_value,
    updated_by = p_user_id,
    updated_at = NOW()
  WHERE setting_key = p_key;
  
  RETURN FOUND;
END;
$$;

-- Function to check if payment can proceed based on compliance rules
CREATE OR REPLACE FUNCTION check_payment_compliance(
  p_contractor_id uuid,
  p_amount_cents BIGINT
)
RETURNS TABLE (
  can_proceed BOOLEAN,
  blocked_reasons TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_wcb_setting JSONB;
  v_stat_dec_setting JSONB;
  v_reasons TEXT[] := ARRAY[]::TEXT[];
  v_contractor RECORD;
BEGIN
  -- Get contractor info
  SELECT * INTO v_contractor FROM public.contractors WHERE id = p_contractor_id;
  
  -- Check WCB compliance
  v_wcb_setting := get_system_setting('payment_wcb_block');
  IF (v_wcb_setting->>'enabled')::BOOLEAN = true THEN
    IF v_contractor.wcb_clearance_expiry IS NULL OR v_contractor.wcb_clearance_expiry < CURRENT_DATE THEN
      v_reasons := array_append(v_reasons, 'WCB clearance is expired or missing');
    END IF;
  END IF;
  
  -- Check statutory declaration threshold
  v_stat_dec_setting := get_system_setting('payment_stat_dec_threshold');
  IF (v_stat_dec_setting->>'enabled')::BOOLEAN = true THEN
    IF p_amount_cents > (v_stat_dec_setting->>'threshold_cents')::BIGINT THEN
      v_reasons := array_append(v_reasons, 'Invoice exceeds statutory declaration threshold');
    END IF;
  END IF;
  
  RETURN QUERY SELECT 
    array_length(v_reasons, 1) IS NULL OR array_length(v_reasons, 1) = 0,
    v_reasons;
END;
$$;

-- =====================================================
-- 5. UPDATED_AT TRIGGERS
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to new tables
DROP TRIGGER IF EXISTS update_system_settings_updated_at ON public.system_settings;
CREATE TRIGGER update_system_settings_updated_at
  BEFORE UPDATE ON public.system_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_report_templates_updated_at ON public.report_templates;
CREATE TRIGGER update_report_templates_updated_at
  BEFORE UPDATE ON public.report_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_team_invitations_updated_at ON public.team_invitations;
CREATE TRIGGER update_team_invitations_updated_at
  BEFORE UPDATE ON public.team_invitations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================
