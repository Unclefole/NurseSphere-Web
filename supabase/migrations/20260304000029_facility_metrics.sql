-- MIGRATION 029: facility_metrics
-- Daily shift fill/cancellation rollups per facility.
-- Self-contained: no dependency on helper functions from migrations 007-025.

CREATE TABLE IF NOT EXISTS public.facility_metrics (
  id                        UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  facility_id               UUID        NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  date                      DATE        NOT NULL,
  requested_shifts          INTEGER     NOT NULL DEFAULT 0,
  filled_shifts             INTEGER     NOT NULL DEFAULT 0,
  canceled_shifts           INTEGER     NOT NULL DEFAULT 0,
  avg_time_to_fill_minutes  NUMERIC(10, 2),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT facility_metrics_unique_facility_date UNIQUE (facility_id, date)
);

ALTER TABLE public.facility_metrics
  ADD CONSTRAINT facility_metrics_no_negative_shifts
  CHECK (requested_shifts >= 0 AND filled_shifts >= 0 AND canceled_shifts >= 0);

CREATE INDEX IF NOT EXISTS idx_facility_metrics_facility_date
  ON public.facility_metrics (facility_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_facility_metrics_date
  ON public.facility_metrics (date DESC);

ALTER TABLE public.facility_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "facility_metrics_hospital_admin_read"
  ON public.facility_metrics FOR SELECT
  USING (
    facility_id IN (
      SELECT fa.facility_id FROM public.facility_admins fa WHERE fa.profile_id = auth.uid()
    )
  );

CREATE POLICY "facility_metrics_super_admin_read"
  ON public.facility_metrics FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

CREATE POLICY "facility_metrics_service_role_all"
  ON public.facility_metrics FOR ALL
  USING (auth.role() = 'service_role');
