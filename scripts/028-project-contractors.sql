-- Create project_contractors table for many-to-many relationship between projects and contractors
-- This allows assigning multiple contractors to a project with their trade information

CREATE TABLE IF NOT EXISTS project_contractors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  trade VARCHAR(100), -- e.g., 'Electrical', 'Plumbing', 'HVAC', 'General'
  contract_amount_cents BIGINT DEFAULT 0,
  notes TEXT,
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'terminated')),
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  assigned_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(project_id, contractor_id) -- Prevent duplicate assignments
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_project_contractors_project_id ON project_contractors(project_id);
CREATE INDEX IF NOT EXISTS idx_project_contractors_contractor_id ON project_contractors(contractor_id);
CREATE INDEX IF NOT EXISTS idx_project_contractors_trade ON project_contractors(trade);

-- Enable RLS
ALTER TABLE project_contractors ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY project_contractors_select ON project_contractors
  FOR SELECT
  USING (true);

CREATE POLICY project_contractors_insert ON project_contractors
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY project_contractors_update ON project_contractors
  FOR UPDATE
  USING (true);

CREATE POLICY project_contractors_delete ON project_contractors
  FOR DELETE
  USING (true);

-- Grant permissions
GRANT ALL ON project_contractors TO authenticated;
GRANT ALL ON project_contractors TO service_role;

-- Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_project_contractors_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS project_contractors_updated_at ON project_contractors;
CREATE TRIGGER project_contractors_updated_at
  BEFORE UPDATE ON project_contractors
  FOR EACH ROW
  EXECUTE FUNCTION update_project_contractors_updated_at();
