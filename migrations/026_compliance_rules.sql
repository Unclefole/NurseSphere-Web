-- MIGRATION 026: compliance_rules
-- Facility/state/role-specific credential requirements.
-- Used by ComplianceGuardian to determine what credentials are required for a given context.
-- Run after migrations 001–025.

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.compliance_rules (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  facility_id           UUID        REFERENCES public.facilities(id) ON DELETE CASCADE,
  state                 TEXT,                       -- ISO 3166-2 state code, e.g. 'CA', 'TX'
  role                  TEXT,                       -- e.g. 'RN', 'LVN', 'CNA'
  required_credentials  JSONB       NOT NULL DEFAULT '[]',
  -- JSON schema: [{"type":"RN_LICENSE","required":true,"warn_days":30}, ...]
  effective_date        DATE        NOT NULL DEFAULT CURRENT_DATE,
  source                TEXT        NOT NULL DEFAULT 'manual',  -- 'manual' | 'cms' | 'state_board'
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_compliance_rules_facility_id
  ON public.compliance_rules (facility_id);

CREATE INDEX IF NOT EXISTS idx_compliance_rules_state
  ON public.compliance_rules (state);

CREATE INDEX IF NOT EXISTS idx_compliance_rules_effective_date
  ON public.compliance_rules (effective_date DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.compliance_rules ENABLE ROW LEVEL SECURITY;

-- super_admin: full access
CREATE POLICY "compliance_rules_super_admin_all"
  ON public.compliance_rules
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- hospital_admin: read rules for their own facility
CREATE POLICY "compliance_rules_hospital_admin_read"
  ON public.compliance_rules
  FOR SELECT
  USING (
    facility_id IN (SELECT get_admin_facility_ids(auth.uid()))
  );

-- service_role: full access (for agent writes)
CREATE POLICY "compliance_rules_service_role_all"
  ON public.compliance_rules
  FOR ALL
  USING (auth.role() = 'service_role');
