-- Migration 016: Multi-Admin Facility Invite System

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.admin_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  invited_by uuid NOT NULL REFERENCES public.profiles(id),
  email text NOT NULL,
  role text NOT NULL DEFAULT 'hospital_admin',
  token text NOT NULL UNIQUE DEFAULT md5(gen_random_uuid()::text || gen_random_uuid()::text),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','expired','revoked')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_invites_facility ON public.admin_invites(facility_id);
CREATE INDEX IF NOT EXISTS idx_admin_invites_token ON public.admin_invites(token);
CREATE INDEX IF NOT EXISTS idx_admin_invites_email ON public.admin_invites(email);

ALTER TABLE public.admin_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_manage_invites" ON public.admin_invites
  FOR ALL USING (
    facility_id IN (SELECT facility_id FROM public.facility_admins WHERE profile_id = auth.uid())
  );

-- Allow public read of invites by token (needed for invite accept page)
-- We expose only non-sensitive columns via the GET /api/team/invite/[token] endpoint (server-side)
-- No additional RLS policy needed since the API uses service role for token lookup
