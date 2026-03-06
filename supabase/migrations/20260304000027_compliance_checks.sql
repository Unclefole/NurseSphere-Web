-- MIGRATION 027: compliance_checks
-- Immutable per-nurse credential compliance check records.
-- Self-contained: no dependency on helper functions from migrations 007-025.

DO $$ BEGIN
  CREATE TYPE public.compliance_check_type AS ENUM ('SHIFT_BOOKING','NIGHTLY_SWEEP','ONBOARDING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.compliance_check_result AS ENUM ('PASS','FAIL','WARN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.compliance_checks (
  id           UUID                            DEFAULT gen_random_uuid() PRIMARY KEY,
  nurse_id     UUID                            NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  facility_id  UUID                            REFERENCES public.facilities(id) ON DELETE SET NULL,
  check_type   public.compliance_check_type   NOT NULL,
  result       public.compliance_check_result NOT NULL,
  details      JSONB                           NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ                     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_checks_nurse_id
  ON public.compliance_checks (nurse_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_compliance_checks_facility_id
  ON public.compliance_checks (facility_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_compliance_checks_result
  ON public.compliance_checks (result, created_at DESC);

ALTER TABLE public.compliance_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "compliance_checks_nurse_read_own"
  ON public.compliance_checks FOR SELECT
  USING (nurse_id = auth.uid());

CREATE POLICY "compliance_checks_hospital_admin_read"
  ON public.compliance_checks FOR SELECT
  USING (
    facility_id IN (
      SELECT fa.facility_id FROM public.facility_admins fa WHERE fa.profile_id = auth.uid()
    )
  );

CREATE POLICY "compliance_checks_super_admin_read"
  ON public.compliance_checks FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

CREATE POLICY "compliance_checks_service_role_insert"
  ON public.compliance_checks FOR INSERT
  WITH CHECK (auth.role() = 'service_role');
