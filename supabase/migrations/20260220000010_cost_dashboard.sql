-- ============================================================
-- MODULE 3: Labor Cost Savings Dashboard
-- Migration: 010_cost_dashboard.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cost_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  baseline_type text NOT NULL CHECK (baseline_type IN ('agency_avg_rate','overtime_avg','msp_fee_pct')),
  value numeric NOT NULL,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(facility_id, baseline_type)
);

CREATE TABLE IF NOT EXISTS public.cost_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  shift_id uuid REFERENCES public.shifts(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('staffed_internal','staffed_nursesphere','staffed_agency')),
  hours numeric NOT NULL,
  cost numeric NOT NULL,
  baseline_cost numeric NOT NULL,
  savings numeric GENERATED ALWAYS AS (baseline_cost - cost) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.kpi_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  total_hours numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  total_savings numeric NOT NULL DEFAULT 0,
  agency_dependency_ratio numeric NOT NULL DEFAULT 0, -- 0-1
  overtime_hours numeric NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(facility_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_cost_events_facility ON public.cost_events(facility_id);
CREATE INDEX IF NOT EXISTS idx_cost_events_shift ON public.cost_events(shift_id);
CREATE INDEX IF NOT EXISTS idx_kpi_snapshots_facility ON public.kpi_snapshots(facility_id);

ALTER TABLE public.cost_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_cost_baselines" ON public.cost_baselines
  FOR ALL USING (facility_id IN (SELECT facility_id FROM public.facility_admins WHERE profile_id = auth.uid()));
CREATE POLICY "admins_cost_events" ON public.cost_events
  FOR ALL USING (facility_id IN (SELECT facility_id FROM public.facility_admins WHERE profile_id = auth.uid()));
CREATE POLICY "admins_kpi_snapshots" ON public.kpi_snapshots
  FOR ALL USING (facility_id IN (SELECT facility_id FROM public.facility_admins WHERE profile_id = auth.uid()));
