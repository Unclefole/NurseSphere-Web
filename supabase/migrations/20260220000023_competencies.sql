-- Migration 023: Competency System
-- NurseSphere TIER 3 — Acuity + Litigation Defense Engine
-- Tracks nurse unit-type competencies with scoring, recency, and verification

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS competencies (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nurse_id          uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  unit_type         text        NOT NULL,
  last_worked_at    timestamptz,
  hours_last_12mo   numeric(8,2) DEFAULT 0,
  verified          boolean     DEFAULT false,
  verified_at       timestamptz,
  verified_by       uuid        REFERENCES profiles(id),
  -- Computed: 0-1 scale (1 = worked last month, 0 = never / 12mo+ ago)
  recency_index     numeric(5,4) DEFAULT 0,
  -- Computed: 0-100 score (hours + recency + verification bonus)
  competency_score  numeric(5,2) DEFAULT 0,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),

  CONSTRAINT competencies_unit_type_check CHECK (
    unit_type IN (
      'ICU', 'ER', 'MedSurg', 'Tele', 'NICU', 'PICU',
      'OR', 'L&D', 'Psych', 'Oncology', 'StepDown', 'Float'
    )
  ),
  UNIQUE (nurse_id, unit_type)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_competencies_nurse_id ON competencies(nurse_id);
CREATE INDEX IF NOT EXISTS idx_competencies_unit_type ON competencies(unit_type);
CREATE INDEX IF NOT EXISTS idx_competencies_competency_score ON competencies(competency_score);

-- ── updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_competencies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_competencies_updated_at ON competencies;
CREATE TRIGGER trg_competencies_updated_at
  BEFORE UPDATE ON competencies
  FOR EACH ROW EXECUTE FUNCTION update_competencies_updated_at();

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE competencies ENABLE ROW LEVEL SECURITY;

-- Nurses can read their own competencies
CREATE POLICY "nurses_read_own_competencies"
  ON competencies
  FOR SELECT
  TO authenticated
  USING (
    nurse_id = auth.uid()
  );

-- Facility admins can read competencies for nurses in their facility
CREATE POLICY "facility_admins_read_competencies"
  ON competencies
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM facility_admins fa
      WHERE fa.profile_id = auth.uid()
        AND TRUE -- facility_admin can view competencies (facility-nurse link via shifts, tighten post-launch)
    )
  );

-- Facility admins can insert/update competencies for nurses in their facility
CREATE POLICY "facility_admins_write_competencies"
  ON competencies
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM facility_admins fa
      WHERE fa.profile_id = auth.uid()
        AND TRUE -- facility_admin can view competencies (facility-nurse link via shifts, tighten post-launch)
    )
  );

CREATE POLICY "facility_admins_update_competencies"
  ON competencies
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM facility_admins fa
      WHERE fa.profile_id = auth.uid()
        AND TRUE -- facility_admin can view competencies (facility-nurse link via shifts, tighten post-launch)
    )
  );

-- Service role: full access (no RLS restriction — service key bypasses RLS)
-- Service role access is implicit via SUPABASE_SERVICE_ROLE_KEY
