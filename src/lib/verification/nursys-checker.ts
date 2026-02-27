/**
 * NURSYS Nurse License Verification
 *
 * NURSYS (nursys.com) is the national nurse license verification system,
 * maintained by NCSBN (National Council of State Boards of Nursing).
 * It covers RN and LPN/VN licenses across compact and non-compact states.
 *
 * Registration: https://www.nursys.com/NLV/NLVTerms.aspx
 * API: Requires registration + paid API key
 * Env var: NURSYS_API_KEY
 *
 * PHI Handling:
 *   - lastName used only for API call — never logged
 *   - Audit log: nurseId (UUID), licenseNumber, issuingState, result — no names
 *   - raw_response stored in credential_verifications is sanitized (lastName removed)
 *
 * Behavior when NURSYS_API_KEY not set:
 *   - Returns stub result with status='unverified'
 *   - Never throws
 */

import { createClient } from '@supabase/supabase-js'

// ── Types ──────────────────────────────────────────────────────────────────────

export type NURSYSLicenseStatus =
  | 'active'
  | 'expired'
  | 'surrendered'
  | 'revoked'
  | 'not_found'
  | 'unverified'
  | 'error'

export interface NURSYSVerifyParams {
  licenseNumber: string
  issuingState: string
  lastName: string
  /** nurse UUID — for audit only, never combined with name in logs */
  nurseId: string
  /** optional credential row to link the result */
  credentialId?: string
  /** optional facility context */
  facilityId?: string
}

export interface NURSYSResult {
  valid: boolean
  licenseNumber: string
  issuingState: string
  status: NURSYSLicenseStatus
  expirationDate?: string
  disciplinaryActions?: boolean
  compactPrivilege?: boolean
  licenseType?: string
  source: 'NURSYS'
  checked_at: string
  /** Set when API key missing or service unavailable */
  note?: string
}

// ── NURSYS API response shape (when available) ─────────────────────────────────

interface NURSYSAPIResponse {
  licenseStatus?: string
  expirationDate?: string
  disciplinaryAction?: boolean
  compactStatus?: boolean
  licenseType?: string
  // Other fields omitted
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const NURSYS_API_BASE = 'https://api.nursys.com/v1'
const NURSYS_FETCH_TIMEOUT_MS = 15_000

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function mapNURSYSStatus(raw: string): NURSYSLicenseStatus {
  const normalized = raw.toLowerCase().trim()
  if (normalized.includes('active') || normalized === 'clear') return 'active'
  if (normalized.includes('expir')) return 'expired'
  if (normalized.includes('surrender')) return 'surrendered'
  if (normalized.includes('revok') || normalized.includes('cancel')) return 'revoked'
  return 'not_found'
}

// ── Core verification function ─────────────────────────────────────────────────

/**
 * verifyNurseLicense
 *
 * Verifies a nurse's license against NURSYS.
 * Never throws — always returns a NURSYSResult.
 *
 * If NURSYS_API_KEY is not configured, returns a stub unverified result
 * so the system degrades gracefully without blocking operations.
 */
export async function verifyNurseLicense(params: NURSYSVerifyParams): Promise<NURSYSResult> {
  const checked_at = new Date().toISOString()

  const apiKey = process.env.NURSYS_API_KEY

  // ── Stub mode (no API key) ─────────────────────────────────────────────────
  if (!apiKey) {
    const stubResult: NURSYSResult = {
      valid: false,
      licenseNumber: params.licenseNumber,
      issuingState: params.issuingState,
      status: 'unverified',
      source: 'NURSYS',
      checked_at,
      note: 'NURSYS_API_KEY not configured — verification skipped',
    }
    // Still persist the unverified result for audit trail
    persistNURSYSResult(params, stubResult).catch((err) => {
      console.warn('[NURSYS] Failed to persist stub result. nurseId=%s: %s', params.nurseId, String(err))
    })
    return stubResult
  }

  // ── Live API check ─────────────────────────────────────────────────────────
  let result: NURSYSResult

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), NURSYS_FETCH_TIMEOUT_MS)

    const response = await fetch(
      `${NURSYS_API_BASE}/license/verify`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
          'User-Agent': 'NurseSphere-ComplianceBot/1.0 (compliance@nursesphere.io)',
        },
        body: JSON.stringify({
          license_number: params.licenseNumber,
          issuing_state: params.issuingState,
          last_name: params.lastName,
        }),
      },
    ).finally(() => clearTimeout(timeout))

    if (response.status === 404) {
      result = {
        valid: false,
        licenseNumber: params.licenseNumber,
        issuingState: params.issuingState,
        status: 'not_found',
        source: 'NURSYS',
        checked_at,
      }
    } else if (!response.ok) {
      result = {
        valid: false,
        licenseNumber: params.licenseNumber,
        issuingState: params.issuingState,
        status: 'error',
        source: 'NURSYS',
        checked_at,
        note: `NURSYS API returned HTTP ${response.status}`,
      }
    } else {
      const data: NURSYSAPIResponse = await response.json()
      const licenseStatus = mapNURSYSStatus(data.licenseStatus ?? '')
      const valid = licenseStatus === 'active'

      result = {
        valid,
        licenseNumber: params.licenseNumber,
        issuingState: params.issuingState,
        status: licenseStatus,
        expirationDate: data.expirationDate,
        disciplinaryActions: data.disciplinaryAction ?? false,
        compactPrivilege: data.compactStatus,
        licenseType: data.licenseType,
        source: 'NURSYS',
        checked_at,
      }
    }
  } catch (err) {
    const isAbort = (err as { name?: string })?.name === 'AbortError'
    result = {
      valid: false,
      licenseNumber: params.licenseNumber,
      issuingState: params.issuingState,
      status: 'error',
      source: 'NURSYS',
      checked_at,
      note: isAbort ? 'NURSYS request timed out' : `NURSYS request failed: ${(err as Error).message}`,
    }
  }

  // Persist result (fire-and-forget)
  persistNURSYSResult(params, result).catch((err) => {
    // PHI-safe: only log nurseId and error message
    console.warn('[NURSYS] Failed to persist result. nurseId=%s: %s', params.nurseId, String(err))
  })

  return result
}

// ── Persistence ────────────────────────────────────────────────────────────────

async function persistNURSYSResult(params: NURSYSVerifyParams, result: NURSYSResult): Promise<void> {
  const supabase = createAdminClient()
  if (!supabase) {
    console.warn('[NURSYS] Supabase not configured; skipping persistence. nurseId=%s', params.nurseId)
    return
  }

  // Sanitize: remove lastName from any stored data
  const sanitizedResponse: Record<string, unknown> = {
    valid: result.valid,
    status: result.status,
    licenseNumber: result.licenseNumber,
    issuingState: result.issuingState,
    expirationDate: result.expirationDate ?? null,
    disciplinaryActions: result.disciplinaryActions ?? null,
    compactPrivilege: result.compactPrivilege ?? null,
    licenseType: result.licenseType ?? null,
    note: result.note ?? null,
    checked_at: result.checked_at,
    // Intentionally omit: lastName — PHI
  }

  const verificationResult: 'clear' | 'flagged' | 'unverified' | 'error' =
    result.status === 'active'
      ? 'clear'
      : result.status === 'revoked' || result.status === 'surrendered'
      ? 'flagged'
      : result.status === 'unverified'
      ? 'unverified'
      : result.status === 'error'
      ? 'error'
      : result.status === 'not_found'
      ? 'unverified'
      : 'unverified'

  // Re-verify in 90 days (NURSYS licenses are checked quarterly in healthcare staffing)
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 90)

  const { error } = await supabase.from('credential_verifications').insert({
    credential_id: params.credentialId ?? null,
    nurse_id: params.nurseId,
    facility_id: params.facilityId ?? null,
    verification_type: 'nursys_license',
    result: verificationResult,
    raw_response: sanitizedResponse,
    verified_at: result.checked_at,
    expires_at: expiresAt.toISOString(),
    notes: result.note ?? null,
  })

  if (error) {
    console.warn('[NURSYS] Failed to insert credential_verifications: %s', error.message)
  } else {
    // PHI-safe: only IDs + result
    console.info(
      '[NURSYS] Verification stored. nurseId=%s licenseNumber=%s state=%s result=%s',
      params.nurseId,
      params.licenseNumber,
      params.issuingState,
      verificationResult,
    )
  }
}
