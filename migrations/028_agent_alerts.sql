-- MIGRATION 028: agent_alerts
-- General-purpose alert queue for all NurseSphere agents.
-- Intentionally named agent_alerts (not alerts) to avoid collision with compliance_alerts (Tier 1).
-- Delivery (email, push, webhook) is handled by a separate notification layer.
-- Run after migration 027.

-- ── Enums ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.agent_alert_type AS ENUM (
    'CREDENTIAL_EXPIRING',
    'CREDENTIAL_EXPIRED',
    'COMPLIANCE_FAIL',
    'SHORTAGE_RISK'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.agent_alert_severity AS ENUM (
    'LOW',
    'MED',
    'HIGH'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.agent_alert_status AS ENUM (
    'NEW',
    'SENT',
    'ACKED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agent_alerts (
  id          UUID                          DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID                          NOT NULL,
  -- For nurse/admin alerts: references profiles(id)
  -- For facility shortage alerts: references facilities(id)
  -- Not a FK to support both tables; enforce in application layer
  type        public.agent_alert_type      NOT NULL,
  severity    public.agent_alert_severity  NOT NULL,
  payload     JSONB                         NOT NULL DEFAULT '{}',
  -- payload must contain only UUIDs and non-PHI metadata
  -- schema varies by type (see agent implementations for exact payload shape)
  status      public.agent_alert_status    NOT NULL DEFAULT 'NEW',
  created_at  TIMESTAMPTZ                   NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_agent_alerts_user_id
  ON public.agent_alerts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_alerts_status
  ON public.agent_alerts (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_alerts_type_severity
  ON public.agent_alerts (type, severity, created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.agent_alerts ENABLE ROW LEVEL SECURITY;

-- users: read their own alerts
CREATE POLICY "agent_alerts_user_read_own"
  ON public.agent_alerts
  FOR SELECT
  USING (user_id = auth.uid());

-- users: acknowledge (update status) their own alerts
CREATE POLICY "agent_alerts_user_ack_own"
  ON public.agent_alerts
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (status = 'ACKED');

-- super_admin: read all
CREATE POLICY "agent_alerts_super_admin_read"
  ON public.agent_alerts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- hospital_admin: read alerts for their facility nurses
CREATE POLICY "agent_alerts_hospital_admin_read"
  ON public.agent_alerts
  FOR SELECT
  USING (
    user_id IN (SELECT get_facility_nurse_ids(
      (SELECT id FROM public.facility_admins WHERE profile_id = auth.uid() LIMIT 1)
    ))
    OR
    user_id IN (SELECT get_admin_facility_ids(auth.uid()))  -- facility-level shortage alerts
  );

-- service_role: full insert/update (agents write, notification layer updates status)
CREATE POLICY "agent_alerts_service_role_all"
  ON public.agent_alerts
  FOR ALL
  USING (auth.role() = 'service_role');
