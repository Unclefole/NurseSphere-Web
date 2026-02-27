/**
 * OIG LEIE Exclusion Checker
 *
 * Office of Inspector General — List of Excluded Individuals/Entities
 * Dataset: https://oig.hhs.gov/exclusions/downloadables.asp
 * Updated monthly.
 *
 * V1 Strategy:
 *   1. Attempt OIG's online search API endpoint (undocumented but stable JSON endpoint)
 *   2. On failure: return graceful stub with status='unavailable'
 *
 * HIPAA / PHI Handling:
 *   - NEVER log firstName/lastName in plain text
 *   - Log only: nurse_id (UUID), check_type, result, checked_at
 *   - raw_response stored in credential_verifications is sanitized (name removed before storage)
 */

import { createClient } from '@supabase/supabase-js'

// ── Types ──────────────────────────────────────────────────────────────────────

export type OIGStatus = 'excluded' | 'clear' | 'unavailable' | 'error'

export interface OIGResult {
  excluded: boolean
  status: OIGStatus
  reason?: string
  exclusion_date?: string
  reinstatement_date?: string
  npi?: string
  source: 'OIG_LEIE'
  checked_at: string
  /** Non-null only when status='unavailable' or 'error' */
  note?: string
}

export interface OIGCheckParams {
  firstName: string
  lastName: string
  npi?: string
  /** nurse UUID — for audit logging only, never combined with name in logs */
  nurseId: string
  /** optional facility context */
  facilityId?: string
  /** if set, stores result in credential_verifications table */
  credentialId?: string
}

// ── OIG Search endpoint ────────────────────────────────────────────────────────

/**
 * OIG maintains a JSON-returning search endpoint used by their exclusion search UI.
 * This is not a published API but is stable and freely used by compliance tools.
 * URL: https://exclusions.oig.hhs.gov/search.json
 */
const OIG_SEARCH_URL = 'https://exclusions.oig.hhs.gov/search.json'
const OIG_FETCH_TIMEOUT_MS = 10_000

interface OIGSearchRecord {
  EXCLTYPE?: string
  EXCLDATE?: string
  REINDATE?: string
  NPI?: string
  LASTNAME?: string
  FIRSTNAME?: string
  MIDNAME?: string
  // additional fields omitted
}

interface OIGSearchResponse {
  exclusions?: OIGSearchRecord[]
  total?: number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * Normalize a name component for fuzzy matching.
 * Removes accents, lowercases, trims whitespace.
 */
function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Check if a record matches the provided name.
 * Uses exact match after normalization; strict enough for compliance.
 */
function recordMatchesName(record: OIGSearchRecord, firstName: string, lastName: string): boolean {
  const recFirst = normalizeName(record.FIRSTNAME ?? '')
  const recLast = normalizeName(record.LASTNAME ?? '')
  const queryFirst = normalizeName(firstName)
  const queryLast = normalizeName(lastName)
  return recFirst === queryFirst && recLast === queryLast
}

// ── Core check function ────────────────────────────────────────────────────────

/**
 * checkOIGExclusion
 *
 * Queries OIG LEIE for the given nurse.
 * Never throws — always returns an OIGResult.
 *
 * PHI safety:
 *   - firstName/lastName are used only for the HTTP request and match comparison
 *   - They are NEVER written to logs or stored in the result
 */
export async function checkOIGExclusion(params: OIGCheckParams): Promise<OIGResult> {
  const checked_at = new Date().toISOString()

  let result: OIGResult

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), OIG_FETCH_TIMEOUT_MS)

    const searchParams = new URLSearchParams({
      lastname: params.lastName,
      firstname: params.firstName,
      ...(params.npi ? { npi: params.npi } : {}),
    })

    const response = await fetch(`${OIG_SEARCH_URL}?${searchParams.toString()}`, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'NurseSphere-ComplianceBot/1.0 (compliance@nursesphere.io)',
      },
    }).finally(() => clearTimeout(timeout))

    if (!response.ok) {
      // OIG endpoint returned an error — treat as unavailable, not a block
      result = {
        excluded: false,
        status: 'unavailable',
        source: 'OIG_LEIE',
        checked_at,
        note: `OIG endpoint returned HTTP ${response.status}`,
      }
    } else {
      const data: OIGSearchResponse = await response.json()
      const exclusions = data.exclusions ?? []

      // Check if any record matches — use name matching (NPI if provided is bonus)
      const match = exclusions.find((rec) => {
        const nameMatch = recordMatchesName(rec, params.firstName, params.lastName)
        if (!nameMatch) return false
        // If NPI provided, require NPI match too (reduces false positives for common names)
        if (params.npi && rec.NPI && rec.NPI !== params.npi) return false
        return true
      })

      if (match) {
        result = {
          excluded: true,
          status: 'excluded',
          reason: match.EXCLTYPE,
          exclusion_date: match.EXCLDATE,
          reinstatement_date: match.REINDATE || undefined,
          npi: match.NPI,
          source: 'OIG_LEIE',
          checked_at,
        }
      } else {
        result = {
          excluded: false,
          status: 'clear',
          source: 'OIG_LEIE',
          checked_at,
        }
      }
    }
  } catch (err) {
    const isAbort = (err as { name?: string })?.name === 'AbortError'
    result = {
      excluded: false,
      status: 'unavailable',
      source: 'OIG_LEIE',
      checked_at,
      note: isAbort ? 'OIG request timed out' : `OIG request failed: ${(err as Error).message}`,
    }
  }

  // Persist result (fire-and-forget; do NOT await to keep caller fast)
  persistOIGResult(params, result).catch((err) => {
    // PHI-safe: only log nurse_id and error, not name
    console.warn('[OIG] Failed to persist result for nurseId=%s: %s', params.nurseId, String(err))
  })

  return result
}

// ── Persistence ────────────────────────────────────────────────────────────────

async function persistOIGResult(params: OIGCheckParams, result: OIGResult): Promise<void> {
  const supabase = createAdminClient()
  if (!supabase) {
    console.warn('[OIG] Supabase not configured; skipping persistence. nurseId=%s', params.nurseId)
    return
  }

  // Sanitize raw_response — remove any name fields before storage
  const sanitizedResponse: Record<string, unknown> = {
    excluded: result.excluded,
    status: result.status,
    exclusion_date: result.exclusion_date ?? null,
    reinstatement_date: result.reinstatement_date ?? null,
    reason: result.reason ?? null,
    npi: result.npi ?? null,
    note: result.note ?? null,
    checked_at: result.checked_at,
    // Intentionally omit: firstName, lastName — PHI
  }

  const verificationResult =
    result.status === 'excluded'
      ? 'flagged'
      : result.status === 'unavailable' || result.status === 'error'
      ? 'unverified'
      : 'clear'

  // Re-verify in 30 days
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 30)

  const { error } = await supabase.from('credential_verifications').insert({
    credential_id: params.credentialId ?? null,
    nurse_id: params.nurseId,
    facility_id: params.facilityId ?? null,
    verification_type: 'oig_exclusion',
    result: verificationResult,
    raw_response: sanitizedResponse,
    verified_at: result.checked_at,
    expires_at: expiresAt.toISOString(),
    notes: result.note ?? null,
  })

  if (error) {
    // Phantom guard — table may not exist yet in all envs
    console.warn('[OIG] Failed to insert credential_verifications: %s', error.message)
  } else {
    // PHI-safe audit log: only IDs and result
    console.info(
      '[OIG] Verification stored. nurseId=%s result=%s checked_at=%s',
      params.nurseId,
      verificationResult,
      result.checked_at,
    )
  }
}

// ── Bulk cache helpers (for future monthly download) ──────────────────────────

/**
 * cacheOIGData
 *
 * Downloads the OIG LEIE monthly exclusion CSV and stores it for local lookups.
 * This is the preferred production approach for high-volume checks.
 *
 * V1: Stub — online search is sufficient for operator phase.
 * V2: Download https://oig.hhs.gov/exclusions/downloadables.asp (UPDATED.csv)
 *     Store in Redis/Postgres full-text index for fast local lookups.
 */
export async function cacheOIGData(): Promise<{ cached: boolean; note: string }> {
  // TODO V2: implement monthly bulk download and caching
  return {
    cached: false,
    note: 'Bulk cache not yet implemented. Using online OIG search endpoint.',
  }
}

/**
 * isExcluded (cached list version)
 *
 * V1 stub — falls back to online check.
 * V2: check against locally cached/indexed dataset.
 */
export async function isExcluded(
  firstName: string,
  lastName: string,
  nurseId: string,
  npi?: string,
): Promise<boolean> {
  const result = await checkOIGExclusion({ firstName, lastName, npi, nurseId })
  return result.excluded
}
