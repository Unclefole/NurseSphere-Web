-- MIGRATION 030: credentials — add extracted_json + updated_at
-- Adds structured extraction output column to the credentials table.
-- Used by CredentialIntelligence agent to store parsed document fields.
-- Run after migration 029.

-- ── Add extracted_json column ─────────────────────────────────────────────────

ALTER TABLE public.credentials
  ADD COLUMN IF NOT EXISTS extracted_json JSONB;

-- extracted_json schema (written by CredentialIntelligence agent):
-- {
--   "issuer":          "California Board of Registered Nursing" | null,
--   "issued_at":       "2022-01-15" | null,
--   "expires_at":      "2026-01-14" | null,
--   "license_number":  "RN123456"   | null,
--   "confidence":      {"issuer": 0.9, "issued_at": 0.8, "expires_at": 0.95, "license_number": 0.7},
--   "extraction_method": "placeholder" | "manual" | "ocr" | "ai",
--   "extracted_at":    "2025-02-27T10:00:00Z"
-- }

-- ── Add updated_at column (needed by CredentialIntelligence update) ───────────

ALTER TABLE public.credentials
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Backfill updated_at from created_at for existing rows
UPDATE public.credentials
  SET updated_at = created_at
  WHERE updated_at IS NULL;

-- ── Index on extraction method for batch re-extraction queries ────────────────

CREATE INDEX IF NOT EXISTS idx_credentials_extracted_method
  ON public.credentials ((extracted_json->>'extraction_method'));

-- ── Verify ────────────────────────────────────────────────────────────────────

-- After running, verify with:
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'credentials'
--   AND column_name IN ('extracted_json', 'updated_at');
-- Expected: 2 rows
