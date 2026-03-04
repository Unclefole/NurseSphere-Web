-- MIGRATION 027: compliance_checks
-- Immutable record of every compliance check run by the ComplianceGuardian agent.
-- Distinct from compliance_sweep_log (which tracks external OIG/NURSYS sweeps).
-- compliance_checks = per-nurse credential status evaluation.
-- Run after migration 026.

-- ── Enums ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.compliance_check_type AS ENUM (
    'SHIFT_BOOKING',
    'NIGHTLY_SWEEP',
    'ONBOARDING'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.compliance_check_result AS ENUM (
    'PASS',
    'FAIL',
    'WARN'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.compliance_checks (
  id           UUID                            DEFAULT gen_random_uuid() PRIMARY KEY,
  nurse_id     UUID                            NOT NULL REFERENCES public.profiles(id)  ON DELETE CASCADE,
  facility_id  UUID                            REFERENCES public.facilities(id)         ON DELETE SET NULL,
  check_type   public.compliance_check_type   NOT NULL,
  result       public.compliance_check_result NOT NULL,
  details      JSONB                           NOT NULL DEFAULT '{}',
  -- details schema:
  -- {
  --   "missing":  [{"type": "RN_LICENSE", "required": true}],
  --   "expired":  [{"credential_id": "...", "type": "BLS", "expired_at": "2024-01-01"}],
  --   "expiring": [{"credential_id": "...", "type": "ACLS", "expires_at": "2025-03-15", "days_until_expiry": 12}],
  --   "run_mode": "nightly"
  -- }
  created_at   TIMESTAMPTZ                     NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_compliance_checks_nurse_id
  ON public.compliance_checks (nurse_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_compliance_checks_facility_id
  ON public.compliance_checks (facility_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_compliance_checks_result
  ON public.compliance_checks (result, created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.compliance_checks ENABLE ROW LEVEL SECURITY;

-- nurses: read only their own checks
CREATE POLICY "compliance_checks_nurse_read_own"
  ON public.compliance_checks
  FOR SELECT
  USING (nurse_id = auth.uid());

-- hospital_admin: read checks for nurses in their facility
CREATE POLICY "compliance_checks_hospital_admin_read"
  ON public.compliance_checks
  FOR SELECT
  USING (
    facility_id IN (SELECT get_admin_facility_ids(auth.uid()))
  );

-- super_admin: full read
CREATE POLICY "compliance_checks_super_admin_read"
  ON public.compliance_checks
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- service_role: insert only (agents write, never update)
CREATE POLICY "compliance_checks_service_role_insert"
  ON public.compliance_checks
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');
