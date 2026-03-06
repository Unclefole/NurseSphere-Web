-- MIGRATION 026: compliance_rules
-- Facility/state/role-specific credential requirements.
-- Self-contained: no dependency on helper functions from migrations 007-025.

CREATE TABLE IF NOT EXISTS public.compliance_rules (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  facility_id           UUID        REFERENCES public.facilities(id) ON DELETE CASCADE,
  state                 TEXT,
  role                  TEXT,
  required_credentials  JSONB       NOT NULL DEFAULT '[]',
  effective_date        DATE        NOT NULL DEFAULT CURRENT_DATE,
  source                TEXT        NOT NULL DEFAULT 'manual',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_rules_facility_id
  ON public.compliance_rules (facility_id);

CREATE INDEX IF NOT EXISTS idx_compliance_rules_state
  ON public.compliance_rules (state);

CREATE INDEX IF NOT EXISTS idx_compliance_rules_effective_date
  ON public.compliance_rules (effective_date DESC);

ALTER TABLE public.compliance_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "compliance_rules_super_admin_all"
  ON public.compliance_rules FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

CREATE POLICY "compliance_rules_hospital_admin_read"
  ON public.compliance_rules FOR SELECT
  USING (
    facility_id IN (
      SELECT fa.facility_id FROM public.facility_admins fa WHERE fa.profile_id = auth.uid()
    )
  );

CREATE POLICY "compliance_rules_service_role_all"
  ON public.compliance_rules FOR ALL
  USING (auth.role() = 'service_role');
