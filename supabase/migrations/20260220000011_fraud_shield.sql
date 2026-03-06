-- MODULE 4: Fraud + Identity Shield
-- Creates suspicious_events table for tracking fraud detection events

CREATE TABLE IF NOT EXISTS public.suspicious_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid REFERENCES public.facilities(id) ON DELETE SET NULL,
  nurse_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'duplicate_account','ip_anomaly','rapid_cancellations',
    'payment_anomaly','credential_mismatch','login_burst'
  )),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  evidence jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','closed','false_positive')),
  resolved_by uuid REFERENCES public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suspicious_events_nurse ON public.suspicious_events(nurse_id);
CREATE INDEX IF NOT EXISTS idx_suspicious_events_facility ON public.suspicious_events(facility_id);
CREATE INDEX IF NOT EXISTS idx_suspicious_events_status ON public.suspicious_events(status);
CREATE INDEX IF NOT EXISTS idx_suspicious_events_type ON public.suspicious_events(event_type);

ALTER TABLE public.suspicious_events ENABLE ROW LEVEL SECURITY;

-- Admins see their facility events
CREATE POLICY "admins_suspicious_events" ON public.suspicious_events
  FOR ALL USING (
    facility_id IS NULL OR
    facility_id IN (SELECT facility_id FROM public.facility_admins WHERE profile_id = auth.uid())
  );

-- Super admins see all (check profiles role)
CREATE POLICY "super_admin_all_events" ON public.suspicious_events
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE TRIGGER update_suspicious_events_updated_at BEFORE UPDATE ON public.suspicious_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
