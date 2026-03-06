-- 014_timecards.sql
-- Timecard system: nurses clock in/out, admins approve, approved timecards trigger payouts.
-- RLS enforced: nurses see own; admins see their facility.

CREATE TABLE IF NOT EXISTS public.timecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  nurse_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  break_minutes int NOT NULL DEFAULT 0,
  total_hours numeric GENERATED ALWAYS AS (
    CASE WHEN clock_in_at IS NOT NULL AND clock_out_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (clock_out_at - clock_in_at)) / 3600 - (break_minutes::numeric / 60)
    ELSE NULL END
  ) STORED,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','approved','disputed','paid')),
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid REFERENCES public.profiles(id),
  dispute_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(shift_id, nurse_id)
);

CREATE INDEX IF NOT EXISTS idx_timecards_shift ON public.timecards(shift_id);
CREATE INDEX IF NOT EXISTS idx_timecards_nurse ON public.timecards(nurse_id);
CREATE INDEX IF NOT EXISTS idx_timecards_facility ON public.timecards(facility_id);
CREATE INDEX IF NOT EXISTS idx_timecards_status ON public.timecards(status);

ALTER TABLE public.timecards ENABLE ROW LEVEL SECURITY;

-- Nurses can see and manage their own timecards
CREATE POLICY "nurses_own_timecards" ON public.timecards
  FOR ALL USING (auth.uid() = nurse_id);

-- Facility admins can see and manage timecards for their facility
CREATE POLICY "admins_facility_timecards" ON public.timecards
  FOR ALL USING (
    facility_id IN (SELECT facility_id FROM public.facility_admins WHERE profile_id = auth.uid())
  );

-- Auto-update updated_at on every change
CREATE TRIGGER update_timecards_updated_at BEFORE UPDATE ON public.timecards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
