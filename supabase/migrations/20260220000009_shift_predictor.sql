-- ============================================================
-- MODULE 2: Shift Fill Predictor
-- Migration: 009_shift_predictor.sql
-- ============================================================

-- shift_candidates table
CREATE TABLE IF NOT EXISTS public.shift_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  nurse_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  score_accept float NOT NULL DEFAULT 0 CHECK (score_accept >= 0 AND score_accept <= 1),
  score_fit float NOT NULL DEFAULT 0 CHECK (score_fit >= 0 AND score_fit <= 1),
  rank int NOT NULL DEFAULT 0,
  reasons jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(shift_id, nurse_id)
);

-- shift_risk table
CREATE TABLE IF NOT EXISTS public.shift_risk (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  fill_probability float NOT NULL DEFAULT 0.5 CHECK (fill_probability >= 0 AND fill_probability <= 1),
  risk_level text NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low','medium','high')),
  recommended_rate_delta int NOT NULL DEFAULT 0,
  recommended_actions jsonb NOT NULL DEFAULT '[]',
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(shift_id)
);

CREATE INDEX IF NOT EXISTS idx_shift_candidates_shift ON public.shift_candidates(shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_candidates_nurse ON public.shift_candidates(nurse_id);
CREATE INDEX IF NOT EXISTS idx_shift_risk_facility ON public.shift_risk(facility_id);
CREATE INDEX IF NOT EXISTS idx_shift_risk_level ON public.shift_risk(risk_level);

ALTER TABLE public.shift_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_risk ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_facility_candidates" ON public.shift_candidates
  FOR ALL USING (facility_id IN (SELECT facility_id FROM public.facility_admins WHERE profile_id = auth.uid()));

CREATE POLICY "admins_facility_risk" ON public.shift_risk
  FOR ALL USING (facility_id IN (SELECT facility_id FROM public.facility_admins WHERE profile_id = auth.uid()));
