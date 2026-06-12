-- =====================================================
-- 044 - Contractor portal invitations
-- =====================================================
-- Mirrors team_invitations, but links an invite to an EXISTING
-- contractor record so accepting the invite attaches a login
-- (auth_user_id) to that contractor. This unblocks the vendor portal.
-- Additive only: no existing tables or columns are modified.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.contractor_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  invited_by uuid REFERENCES public.users(id),
  invitation_token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  accepted_at TIMESTAMPTZ,
  created_user_id uuid REFERENCES public.users(id),
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'accepted', 'expired', 'cancelled'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contractor_invitations_contractor ON public.contractor_invitations(contractor_id);
CREATE INDEX IF NOT EXISTS idx_contractor_invitations_email ON public.contractor_invitations(email);
CREATE INDEX IF NOT EXISTS idx_contractor_invitations_token ON public.contractor_invitations(invitation_token);
CREATE INDEX IF NOT EXISTS idx_contractor_invitations_status ON public.contractor_invitations(status);

-- Enable RLS. All access is performed server-side via the service-role
-- admin client (which bypasses RLS), consistent with team_invitations.
-- No public policies are added, so the table is locked down to anon/auth roles.
ALTER TABLE public.contractor_invitations ENABLE ROW LEVEL SECURITY;
