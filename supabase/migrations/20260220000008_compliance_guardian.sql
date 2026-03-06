-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 008_compliance_guardian.sql
-- Module: Compliance Guardian — credentials, alerts, scores
-- Date: 2026-02-24
-- Prerequisites: 001_facility_admins.sql, 002_facility_rls_policies.sql
-- ═══════════════════════════════════════════════════════════════════════════════

-- Enable UUID extension if not already
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. credentials table
--    NOTE: A credentials table already exists with different columns.
--    This migration ADDS the new compliance-guardian columns if missing
--    and creates a NEW compliance-specific table with IF NOT EXISTS guard.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.credentials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nurse_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  facility_id     uuid REFERENCES public.facilities(id) ON DELETE SET NULL,
  type            text NOT NULL,
  -- e.g. RN_LICENSE, ACLS, BLS, PALS, NIHSS, CPR, PALS, NRP, etc.
  issuing_state   text,
  number          text,
  status          text NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('active','expiring','expired','pending_verification','rejected')),
  expiration_date date NOT NULL,
  verified_at     timestamptz,
  verified_by     uuid REFERENCES public.profiles(id),
  source          text NOT NULL DEFAULT 'upload'
    CHECK (source IN ('upload','manual','api')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. compliance_alerts table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.compliance_alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id   uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  nurse_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  credential_id uuid REFERENCES public.credentials(id) ON DELETE SET NULL,
  alert_type    text NOT NULL CHECK (alert_type IN (
    'expiring_30','expiring_7','expired','mismatch','missing_required',
    'sanction_check_failed','oig_check_due'
  )),
  severity      text NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low','medium','high','critical')),
  due_at        timestamptz,
  status        text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','acknowledged','resolved')),
  evidence      jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. compliance_scores table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.compliance_scores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  nurse_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  score       int NOT NULL DEFAULT 100 CHECK (score >= 0 AND score <= 100),
  reasons     jsonb NOT NULL DEFAULT '{}',
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(facility_id, nurse_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Additive columns (for pre-existing credentials table)
-- Existing columns: id, user_id, document_type, document_name, status,
--                   issued_at, expires_at, verified_at, verified_by,
--                   document_url, created_at, updated_at
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.credentials ADD COLUMN IF NOT EXISTS facility_id uuid REFERENCES public.facilities(id) ON DELETE SET NULL;
ALTER TABLE public.credentials ADD COLUMN IF NOT EXISTS nurse_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.credentials ADD COLUMN IF NOT EXISTS issuing_state text;
ALTER TABLE public.credentials ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'upload';

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes (using actual column names from existing schema)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_credentials_nurse_id      ON public.credentials(nurse_id);
CREATE INDEX IF NOT EXISTS idx_credentials_facility_id   ON public.credentials(facility_id);
CREATE INDEX IF NOT EXISTS idx_credentials_status        ON public.credentials(status);
CREATE INDEX IF NOT EXISTS idx_credentials_expiration    ON public.credentials(expires_at);

CREATE INDEX IF NOT EXISTS idx_compliance_alerts_facility ON public.compliance_alerts(facility_id);
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_nurse    ON public.compliance_alerts(nurse_id);
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_status   ON public.compliance_alerts(status);

CREATE INDEX IF NOT EXISTS idx_compliance_scores_facility ON public.compliance_scores(facility_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.credentials       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_scores ENABLE ROW LEVEL SECURITY;

-- Drop if re-running
DROP POLICY IF EXISTS "nurses_own_credentials"        ON public.credentials;
DROP POLICY IF EXISTS "admins_facility_credentials"   ON public.credentials;
DROP POLICY IF EXISTS "admins_facility_alerts"        ON public.compliance_alerts;
DROP POLICY IF EXISTS "nurses_own_alerts"             ON public.compliance_alerts;
DROP POLICY IF EXISTS "admins_facility_scores"        ON public.compliance_scores;
DROP POLICY IF EXISTS "nurses_own_scores"             ON public.compliance_scores;

-- credentials: nurses see/manage their own
CREATE POLICY "nurses_own_credentials" ON public.credentials
  FOR ALL USING (auth.uid() = nurse_id);

-- credentials: facility admins see/manage their facility's credentials
CREATE POLICY "admins_facility_credentials" ON public.credentials
  FOR ALL USING (
    facility_id IN (
      SELECT facility_id FROM public.facility_admins WHERE profile_id = auth.uid()
    )
  );

-- compliance_alerts: facility admins
CREATE POLICY "admins_facility_alerts" ON public.compliance_alerts
  FOR ALL USING (
    facility_id IN (
      SELECT facility_id FROM public.facility_admins WHERE profile_id = auth.uid()
    )
  );

-- compliance_alerts: nurses read their own
CREATE POLICY "nurses_own_alerts" ON public.compliance_alerts
  FOR SELECT USING (auth.uid() = nurse_id);

-- compliance_scores: facility admins
CREATE POLICY "admins_facility_scores" ON public.compliance_scores
  FOR ALL USING (
    facility_id IN (
      SELECT facility_id FROM public.facility_admins WHERE profile_id = auth.uid()
    )
  );

-- compliance_scores: nurses read their own
CREATE POLICY "nurses_own_scores" ON public.compliance_scores
  FOR SELECT USING (auth.uid() = nurse_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at trigger function (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

DROP TRIGGER IF EXISTS update_credentials_updated_at       ON public.credentials;
DROP TRIGGER IF EXISTS update_compliance_alerts_updated_at ON public.compliance_alerts;

CREATE TRIGGER update_credentials_updated_at
  BEFORE UPDATE ON public.credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_compliance_alerts_updated_at
  BEFORE UPDATE ON public.compliance_alerts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
