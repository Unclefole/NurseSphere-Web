-- MIGRATION 029: facility_metrics
-- Daily shift fill/cancellation rollups per facility.
-- Written by WorkforceOptimization agent. Used to compute shortage risk and trends.
-- Run after migration 028.

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.facility_metrics (
  id                        UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  facility_id               UUID        NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  date                      DATE        NOT NULL,
  requested_shifts          INTEGER     NOT NULL DEFAULT 0,
  filled_shifts             INTEGER     NOT NULL DEFAULT 0,
  canceled_shifts           INTEGER     NOT NULL DEFAULT 0,
  avg_time_to_fill_minutes  NUMERIC(10, 2),  -- nullable: not computed in V1
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One row per facility per day
  CONSTRAINT facility_metrics_unique_facility_date UNIQUE (facility_id, date)
);

-- ── Constraints ───────────────────────────────────────────────────────────────

ALTER TABLE public.facility_metrics
  ADD CONSTRAINT facility_metrics_filled_lte_requested
  CHECK (filled_shifts <= requested_shifts + canceled_shifts);

ALTER TABLE public.facility_metrics
  ADD CONSTRAINT facility_metrics_no_negative_shifts
  CHECK (
    requested_shifts >= 0 AND
    filled_shifts    >= 0 AND
    canceled_shifts  >= 0
  );

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_facility_metrics_facility_date
  ON public.facility_metrics (facility_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_facility_metrics_date
  ON public.facility_metrics (date DESC);

-- ── updated_at trigger ────────────────────────────────────────────────────────

-- Reuse the existing update_updated_at_column() trigger function if it exists
-- (created in earlier migrations for timecards, competencies, etc.)
DO $$ BEGIN
  CREATE TRIGGER set_facility_metrics_updated_at
    BEFORE UPDATE ON public.facility_metrics
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
EXCEPTION
  WHEN undefined_function THEN NULL;  -- function doesn't exist yet, skip
  WHEN duplicate_object   THEN NULL;  -- trigger already exists, skip
END $$;

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.facility_metrics ENABLE ROW LEVEL SECURITY;

-- hospital_admin: read their own facility metrics
CREATE POLICY "facility_metrics_hospital_admin_read"
  ON public.facility_metrics
  FOR SELECT
  USING (
    facility_id IN (SELECT get_admin_facility_ids(auth.uid()))
  );

-- super_admin: read all
CREATE POLICY "facility_metrics_super_admin_read"
  ON public.facility_metrics
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- service_role: full access (WorkforceOptimization agent writes daily rollups)
CREATE POLICY "facility_metrics_service_role_all"
  ON public.facility_metrics
  FOR ALL
  USING (auth.role() = 'service_role');
