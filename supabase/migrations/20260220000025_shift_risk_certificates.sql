-- Migration 025: Shift Risk Certificates
-- NurseSphere TIER 3 — Acuity + Litigation Defense Engine
-- Immutable audit records for shift staffing decisions (litigation defense)
-- PHI NEVER stored — nurse identified by UUID only

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shift_risk_certificates (
  id                              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id                        uuid        NOT NULL REFERENCES shifts(id),
  nurse_id                        uuid        NOT NULL REFERENCES profiles(id),
  facility_id                     uuid        NOT NULL REFERENCES facilities(id),

  -- Snapshots at time of certificate issuance (no PHI)
  credential_status_snapshot      jsonb       NOT NULL,
  competency_snapshot             jsonb       NOT NULL,

  -- Scoring at time of certificate
  compliance_score                numeric(5,2) NOT NULL,
  competency_score                numeric(5,2) NOT NULL,

  -- Context
  alternative_candidates_available integer     DEFAULT 0,

  -- Decision basis: { criteria_met: string[], overrides: string[], compliance_score, competency_score }
  decision_basis                  jsonb       NOT NULL,

  -- Override fields
  admin_override                  boolean     DEFAULT false,
  override_justification          text,
  override_actor_id               uuid        REFERENCES profiles(id),

  -- Tamper detection
  certificate_hash                text,

  -- Timestamps
  issued_at                       timestamptz DEFAULT now(),
  created_at                      timestamptz DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_src_shift_id     ON shift_risk_certificates(shift_id);
CREATE INDEX IF NOT EXISTS idx_src_nurse_id     ON shift_risk_certificates(nurse_id);
CREATE INDEX IF NOT EXISTS idx_src_facility_id  ON shift_risk_certificates(facility_id);
CREATE INDEX IF NOT EXISTS idx_src_issued_at    ON shift_risk_certificates(issued_at);

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE shift_risk_certificates ENABLE ROW LEVEL SECURITY;

-- Facility admins: SELECT for their facility
CREATE POLICY "facility_admins_read_risk_certificates"
  ON shift_risk_certificates
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM facility_admins fa
      WHERE fa.profile_id = auth.uid()
        AND fa.facility_id = shift_risk_certificates.facility_id
    )
  );

-- Facility admins: INSERT for their facility
CREATE POLICY "facility_admins_insert_risk_certificates"
  ON shift_risk_certificates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM facility_admins fa
      WHERE fa.profile_id = auth.uid()
        AND fa.facility_id = shift_risk_certificates.facility_id
    )
  );

-- Nurses: SELECT own records
CREATE POLICY "nurses_read_own_risk_certificates"
  ON shift_risk_certificates
  FOR SELECT
  TO authenticated
  USING (
    nurse_id = auth.uid()
  );

-- NO UPDATE or DELETE policies — these records are immutable
-- Service role access is implicit via SUPABASE_SERVICE_ROLE_KEY
