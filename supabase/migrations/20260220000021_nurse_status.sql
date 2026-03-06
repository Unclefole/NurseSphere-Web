-- Migration 021: Nurse Status Field + Compliance Sweep Log
-- NurseSphere TIER 1 — Continuous Compliance Engine
-- PHI constraint: no patient data, no nurse SSN/DOB stored here

-- ── Enum: nurse_status ────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE nurse_status AS ENUM ('active', 'suspended', 'restricted');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── profiles: add status + suspension fields ──────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS status          nurse_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS suspension_reason    text,
  ADD COLUMN IF NOT EXISTS suspension_evidence  jsonb,       -- credential snapshot, NO PHI
  ADD COLUMN IF NOT EXISTS suspended_at         timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_by         uuid REFERENCES profiles(id);

-- Index for fast eligibility checks (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_profiles_status
  ON profiles (status)
  WHERE status != 'active';

-- ── Table: compliance_sweep_log ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance_sweep_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at            timestamptz NOT NULL,
  completed_at          timestamptz,
  nurses_checked        integer     NOT NULL DEFAULT 0,
  alerts_created        integer     NOT NULL DEFAULT 0,
  suspensions_triggered integer     NOT NULL DEFAULT 0,
  error_count           integer     NOT NULL DEFAULT 0,
  status                text        NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- ── RLS: compliance_sweep_log ─────────────────────────────────────────────────
ALTER TABLE compliance_sweep_log ENABLE ROW LEVEL SECURITY;

-- Service role gets full access (INSERT/UPDATE/DELETE via service key bypasses RLS by default,
-- but we add an explicit policy for clarity)
CREATE POLICY "service_role_all_compliance_sweep_log"
  ON compliance_sweep_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can SELECT (for dashboard visibility)
CREATE POLICY "authenticated_select_compliance_sweep_log"
  ON compliance_sweep_log
  FOR SELECT
  TO authenticated
  USING (true);

-- ── Down migration note ───────────────────────────────────────────────────────
-- To roll back:
--   DROP TABLE IF EXISTS compliance_sweep_log;
--   ALTER TABLE profiles
--     DROP COLUMN IF EXISTS suspended_by,
--     DROP COLUMN IF EXISTS suspended_at,
--     DROP COLUMN IF EXISTS suspension_evidence,
--     DROP COLUMN IF EXISTS suspension_reason,
--     DROP COLUMN IF EXISTS status;
--   DROP TYPE IF EXISTS nurse_status;
