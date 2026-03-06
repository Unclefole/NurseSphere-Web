-- MIGRATION 028: agent_alerts
-- General-purpose alert queue for all NurseSphere agents.
-- Named agent_alerts (not alerts) to avoid collision with compliance_alerts.
-- Self-contained: no dependency on helper functions from migrations 007-025.

DO $$ BEGIN
  CREATE TYPE public.agent_alert_type AS ENUM (
    'CREDENTIAL_EXPIRING','CREDENTIAL_EXPIRED','COMPLIANCE_FAIL','SHORTAGE_RISK'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.agent_alert_severity AS ENUM ('LOW','MED','HIGH');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.agent_alert_status AS ENUM ('NEW','SENT','ACKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.agent_alerts (
  id          UUID                          DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID                          NOT NULL,
  type        public.agent_alert_type      NOT NULL,
  severity    public.agent_alert_severity  NOT NULL,
  payload     JSONB                         NOT NULL DEFAULT '{}',
  status      public.agent_alert_status    NOT NULL DEFAULT 'NEW',
  created_at  TIMESTAMPTZ                   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_alerts_user_id
  ON public.agent_alerts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_alerts_status
  ON public.agent_alerts (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_alerts_type_severity
  ON public.agent_alerts (type, severity, created_at DESC);

ALTER TABLE public.agent_alerts ENABLE ROW LEVEL SECURITY;

-- Users read their own alerts
CREATE POLICY "agent_alerts_user_read_own"
  ON public.agent_alerts FOR SELECT
  USING (user_id = auth.uid());

-- Users can acknowledge their own alerts
CREATE POLICY "agent_alerts_user_ack_own"
  ON public.agent_alerts FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (status = 'ACKED');

-- super_admin reads all
CREATE POLICY "agent_alerts_super_admin_read"
  ON public.agent_alerts FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- hospital_admin reads shortage risk alerts for their own facilities
CREATE POLICY "agent_alerts_hospital_admin_read"
  ON public.agent_alerts FOR SELECT
  USING (
    user_id IN (
      SELECT fa.facility_id FROM public.facility_admins fa WHERE fa.profile_id = auth.uid()
    )
  );

-- service_role: full access (agents write, notification layer updates status)
CREATE POLICY "agent_alerts_service_role_all"
  ON public.agent_alerts FOR ALL
  USING (auth.role() = 'service_role');
