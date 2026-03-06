-- Migration 024: Shift Acuity Fields
-- NurseSphere TIER 3 — Acuity + Litigation Defense Engine
-- Adds acuity classification to shifts for competency matching

-- ── Add columns to shifts ─────────────────────────────────────────────────────

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS acuity_level              text,
  ADD COLUMN IF NOT EXISTS required_competencies     jsonb        DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS minimum_competency_score  numeric(5,2) DEFAULT 60,
  ADD COLUMN IF NOT EXISTS acuity_notes              text;

-- ── Check constraint on acuity_level ─────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'shifts'
      AND constraint_name = 'shifts_acuity_level_check'
  ) THEN
    ALTER TABLE shifts ADD CONSTRAINT shifts_acuity_level_check
      CHECK (acuity_level IN ('low', 'moderate', 'high', 'critical'));
  END IF;
END;
$$;

-- ── Index for acuity queries ──────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_shifts_acuity_level ON shifts(acuity_level)
  WHERE acuity_level IS NOT NULL;
