-- ============================================================================
-- Migration 018: Credential Verifications Table
-- NurseSphere — Primary Source Verification (NURSYS + OIG LEIE)
-- ============================================================================

-- Extension already enabled in earlier migrations; guard anyway
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Table ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.credential_verifications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to specific credential (nullable — OIG checks are not credential-specific)
  credential_id   uuid        REFERENCES public.credentials(id) ON DELETE SET NULL,

  -- Required: the nurse being verified
  nurse_id        uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Optional: facility that requested the verification
  facility_id     uuid        REFERENCES public.facilities(id) ON DELETE SET NULL,

  -- What type of check was run
  verification_type text NOT NULL CHECK (verification_type IN (
    'nursys_license',
    'oig_exclusion',
    'background_check',
    'manual'
  )),

  -- Outcome of the check
  result          text        NOT NULL CHECK (result IN (
    'clear',       -- passed / no issues found
    'flagged',     -- exclusion, revocation, or disciplinary action found
    'unverified',  -- API unavailable, key missing, or incomplete data
    'error'        -- unexpected error during verification
  )),

  -- Sanitized API response — NO PHI (names removed before storage)
  raw_response    jsonb,

  -- When the check was performed
  verified_at     timestamptz NOT NULL DEFAULT now(),

  -- When this verification expires (should re-verify)
  -- NURSYS: 90 days | OIG: 30 days | Background: 365 days
  expires_at      timestamptz,

  -- Human-readable note (e.g. "NURSYS_API_KEY not configured")
  notes           text,

  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_verifications_nurse
  ON public.credential_verifications(nurse_id);

CREATE INDEX IF NOT EXISTS idx_verifications_credential
  ON public.credential_verifications(credential_id);

CREATE INDEX IF NOT EXISTS idx_verifications_type
  ON public.credential_verifications(verification_type);

CREATE INDEX IF NOT EXISTS idx_verifications_result
  ON public.credential_verifications(result);

CREATE INDEX IF NOT EXISTS idx_verifications_expires_at
  ON public.credential_verifications(expires_at)
  WHERE expires_at IS NOT NULL;

-- ── Row Level Security ─────────────────────────────────────────────────────────

ALTER TABLE public.credential_verifications ENABLE ROW LEVEL SECURITY;

-- Facility admins can view verifications for nurses at their facility
CREATE POLICY "admins_view_verifications"
  ON public.credential_verifications
  FOR SELECT
  USING (
    facility_id IN (
      SELECT facility_id
      FROM public.facility_admins
      WHERE profile_id = auth.uid()
    )
  );

-- Nurses can view their own verification records
CREATE POLICY "nurses_own_verifications"
  ON public.credential_verifications
  FOR SELECT
  USING (auth.uid() = nurse_id);

-- Service role (backend jobs, API routes using service key) can insert/update all
-- This policy is intentionally permissive for server-side inserts;
-- all write paths go through authenticated server-side code, never client-direct.
CREATE POLICY "service_role_write_verifications"
  ON public.credential_verifications
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── Comment ────────────────────────────────────────────────────────────────────

COMMENT ON TABLE public.credential_verifications IS
  'Primary source verification results from NURSYS (license), OIG LEIE (exclusions), '
  'and other verification sources. raw_response is sanitized — PHI (names) removed before storage.';

COMMENT ON COLUMN public.credential_verifications.raw_response IS
  'Sanitized API response JSON. PHI (first/last name) must be stripped before insert. '
  'Contains: status, dates, result codes only.';

COMMENT ON COLUMN public.credential_verifications.expires_at IS
  'When this verification result should be considered stale and re-run. '
  'NURSYS: 90 days | OIG LEIE: 30 days | Background check: 365 days';
