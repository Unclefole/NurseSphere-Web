-- ============================================================
-- Migration 022: Credential Hashing & Verification Metadata
-- ============================================================
-- Adds SHA-256 integrity hashing and external verification
-- tracking to the credentials table.
--
-- No PHI is stored. All identifiers are system UUIDs.
-- ============================================================

-- Add file integrity columns
ALTER TABLE credentials
  ADD COLUMN IF NOT EXISTS file_hash             TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS hash_algorithm        TEXT        NOT NULL DEFAULT 'SHA-256',
  ADD COLUMN IF NOT EXISTS hashed_at             TIMESTAMPTZ DEFAULT NULL;

-- Add external verification columns
ALTER TABLE credentials
  ADD COLUMN IF NOT EXISTS verification_reference TEXT       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS verified_at            TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS verified_by            UUID        DEFAULT NULL
    REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verification_source    TEXT        DEFAULT NULL;

-- Constraint: verification_source must be a known provider (or NULL)
ALTER TABLE credentials
  DROP CONSTRAINT IF EXISTS credentials_verification_source_check;

ALTER TABLE credentials
  ADD CONSTRAINT credentials_verification_source_check
    CHECK (verification_source IN ('nursys', 'oig', 'manual', 'self_reported') OR verification_source IS NULL);

-- Constraint: hash_algorithm must be a known algorithm
ALTER TABLE credentials
  DROP CONSTRAINT IF EXISTS credentials_hash_algorithm_check;

ALTER TABLE credentials
  ADD CONSTRAINT credentials_hash_algorithm_check
    CHECK (hash_algorithm IN ('SHA-256', 'SHA-512'));

-- Index for integrity queries (find unverified or un-hashed credentials)
CREATE INDEX IF NOT EXISTS idx_credentials_file_hash       ON credentials(file_hash) WHERE file_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credentials_verified_at     ON credentials(verified_at) WHERE verified_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credentials_verified_by     ON credentials(verified_by) WHERE verified_by IS NOT NULL;

-- Comment documentation
COMMENT ON COLUMN credentials.file_hash
  IS 'SHA-256 hex digest of the raw credential file bytes. Used for tamper detection.';
COMMENT ON COLUMN credentials.hash_algorithm
  IS 'Hashing algorithm used to compute file_hash. Default: SHA-256.';
COMMENT ON COLUMN credentials.hashed_at
  IS 'Timestamp when the file hash was computed.';
COMMENT ON COLUMN credentials.verification_reference
  IS 'External verification ID or URL from NURSYS, OIG, or other verifier.';
COMMENT ON COLUMN credentials.verified_at
  IS 'Timestamp when external verification was confirmed.';
COMMENT ON COLUMN credentials.verified_by
  IS 'Profile UUID of the user who triggered verification.';
COMMENT ON COLUMN credentials.verification_source
  IS 'Source of verification: nursys | oig | manual | self_reported.';
