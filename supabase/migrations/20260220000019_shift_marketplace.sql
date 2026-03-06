-- ─── 019 Shift Marketplace ──────────────────────────────────────────────────
-- Cross-facility shift marketplace: nurses browse and apply to open shifts.
-- HIPAA: No PHI stored. All writes audit-logged by callers.

-- ─── Shift Applications ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.shift_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  nurse_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','rejected','withdrawn','expired')),
  applied_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(shift_id, nurse_id) -- one application per shift per nurse
);

CREATE INDEX IF NOT EXISTS idx_shift_applications_shift    ON public.shift_applications(shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_applications_nurse    ON public.shift_applications(nurse_id);
CREATE INDEX IF NOT EXISTS idx_shift_applications_facility ON public.shift_applications(facility_id);
CREATE INDEX IF NOT EXISTS idx_shift_applications_status   ON public.shift_applications(status);

ALTER TABLE public.shift_applications ENABLE ROW LEVEL SECURITY;

-- Nurses see only their own applications
CREATE POLICY "nurses_own_applications" ON public.shift_applications
  FOR ALL USING (auth.uid() = nurse_id);

-- Admins see applications for shifts at their facility
CREATE POLICY "admins_facility_applications" ON public.shift_applications
  FOR ALL USING (
    facility_id IN (
      SELECT facility_id FROM public.facility_admins WHERE profile_id = auth.uid()
    )
  );

-- ─── Nurse Marketplace Preferences ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.nurse_marketplace_prefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nurse_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
  max_commute_miles int DEFAULT 50,
  preferred_shift_types text[] DEFAULT '{}', -- day, night, weekend, prn
  preferred_units text[] DEFAULT '{}',        -- ICU, ED, Med-Surg, etc.
  preferred_roles text[] DEFAULT '{}',        -- RN, LPN, CNA, etc.
  min_hourly_rate numeric DEFAULT 0,
  available_days text[] DEFAULT '{}',         -- mon, tue, wed, thu, fri, sat, sun
  marketplace_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nurse_marketplace_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nurses_own_prefs" ON public.nurse_marketplace_prefs
  FOR ALL USING (auth.uid() = nurse_id);

-- ─── Updated-at Triggers ──────────────────────────────────────────────────────

CREATE TRIGGER update_shift_applications_updated_at
  BEFORE UPDATE ON public.shift_applications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_nurse_prefs_updated_at
  BEFORE UPDATE ON public.nurse_marketplace_prefs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
