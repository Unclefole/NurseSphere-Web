/**
 * NurseSphere — Nurse Verification Orchestrator
 *
 * runNurseVerification(nurseId, facilityId, requestingAdminId)
 *
 * Orchestrates all credential verification checks for a nurse:
 *   1. Fetch nurse's profile + credentials from DB
 *   2. For each RN_LICENSE credential: run NURSYS check
 *   3. Always run OIG LEIE exclusion check
 *   4. All results stored in credential_verifications (handled inside each checker)
 *   5. If any result is 'flagged': create compliance_alert (sanction_check_failed)
 *   6. Update credential status based on NURSYS result
 *   7. Audit log: action='verification.run_complete'
 *
 * PHI: nurse name retrieved from DB but only passed to verifiers; never logged.
 */

import { createClient } from '@supabase/supabase-js'
import { checkOIGExclusion, type OIGResult } from './oig-checker'
import { verifyNurseLicense, type NURSYSResult } from './nursys-checker'
import { writeAuditLog } from '@/lib/audit'

// ── Types ──────────────────────────────────────────────────────────────────────

export type VerificationCheckType = 'nursys_license' | 'oig_exclusion'
export type VerificationResult = 'clear' | 'flagged' | 'unverified' | 'error'
export type OverallVerificationStatus = 'clear' | 'flagged' | 'partial'

export interface VerificationCheckResult {
  type: VerificationCheckType
  result: VerificationResult
  credentialId?: string
  licenseNumber?: string
  issuingState?: string
  status: string
  note?: string
  checked_at: string
  source: 'NURSYS' | 'OIG_LEIE'
}

export interface VerificationSummary {
  nurseId: string
  facilityId: string
  overall: OverallVerificationStatus
  checksRun: number
  flagsFound: number
  checks: VerificationCheckResult[]
  completed_at: string
}

// ── Internal DB types ──────────────────────────────────────────────────────────

interface NurseProfile {
  id: string
  full_name: string | null
  first_name?: string | null
  last_name?: string | null
}

interface CredentialRow {
  id: string
  nurse_id: string
  type: string
  issuing_state: string | null
  number: string | null
  status: string
  expiration_date: string
}

// ── Supabase client ────────────────────────────────────────────────────────────

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role credentials')
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ── Name parsing ───────────────────────────────────────────────────────────────

/**
 * Parse first/last name from full_name string.
 * Handles "First Last", "First Middle Last", "Last, First" formats.
 */
function parseFullName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim()

  // "Last, First" format
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',').map((s) => s.trim())
    return { firstName: parts[1] ?? '', lastName: parts[0] }
  }

  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] }

  const firstName = parts[0]
  const lastName = parts[parts.length - 1]
  return { firstName, lastName }
}

// ── Alert creation ─────────────────────────────────────────────────────────────

async function createSanctionAlert(
  supabase: ReturnType<typeof createAdminClient>,
  nurseId: string,
  facilityId: string,
  evidence: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from('compliance_alerts').insert({
    facility_id: facilityId,
    nurse_id: nurseId,
    credential_id: null,
    alert_type: 'sanction_check_failed',
    severity: 'critical',
    due_at: new Date().toISOString(),
    status: 'open',
    evidence,
  })

  if (error) {
    console.warn('[Verification] Failed to create sanction alert: %s', error.message)
  }
}

// ── Credential status update ───────────────────────────────────────────────────

async function updateCredentialStatus(
  supabase: ReturnType<typeof createAdminClient>,
  credentialId: string,
  nursysResult: NURSYSResult,
): Promise<void> {
  let newStatus: string

  switch (nursysResult.status) {
    case 'active':
      newStatus = 'active'
      break
    case 'expired':
      newStatus = 'expired'
      break
    case 'revoked':
    case 'surrendered':
      newStatus = 'rejected'
      break
    default:
      newStatus = 'pending_verification'
  }

  const updatePayload: Record<string, unknown> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  }

  if (nursysResult.status === 'active') {
    updatePayload.verified_at = nursysResult.checked_at
    updatePayload.source = 'api'
  }

  const { error } = await supabase
    .from('credentials')
    .update(updatePayload)
    .eq('id', credentialId)

  if (error) {
    console.warn('[Verification] Failed to update credential status: %s', error.message)
  }
}

// ── Main orchestrator ──────────────────────────────────────────────────────────

/**
 * runNurseVerification
 *
 * Runs all applicable verification checks for a nurse.
 * Always resolves — never throws.
 */
export async function runNurseVerification(
  nurseId: string,
  facilityId: string,
  requestingAdminId?: string,
): Promise<VerificationSummary> {
  const completed_at = new Date().toISOString()
  const checks: VerificationCheckResult[] = []

  try {
    const supabase = createAdminClient()

    // ── 1. Fetch nurse profile ─────────────────────────────────────────────────
    const { data: profileRaw, error: profileErr } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('id', nurseId)
      .single()

    if (profileErr || !profileRaw) {
      return {
        nurseId,
        facilityId,
        overall: 'partial',
        checksRun: 0,
        flagsFound: 0,
        checks: [],
        completed_at,
      }
    }

    const profile = profileRaw as NurseProfile
    const { firstName, lastName } = parseFullName(profile.full_name ?? 'Unknown')

    // ── 2. Fetch credentials ───────────────────────────────────────────────────
    const { data: credsRaw } = await supabase
      .from('credentials')
      .select('id, nurse_id, type, issuing_state, number, status, expiration_date')
      .eq('nurse_id', nurseId)

    const credentials = (credsRaw ?? []) as CredentialRow[]
    const rnLicenses = credentials.filter((c) => c.type === 'RN_LICENSE' && c.number)

    // ── 3. NURSYS check for each RN_LICENSE ───────────────────────────────────
    for (const cred of rnLicenses) {
      const nursysResult: NURSYSResult = await verifyNurseLicense({
        licenseNumber: cred.number!,
        issuingState: cred.issuing_state ?? 'UNK',
        lastName,           // PHI — used for API call only, not logged
        nurseId,
        credentialId: cred.id,
        facilityId,
      })

      const verificationResult: VerificationResult =
        nursysResult.status === 'active'
          ? 'clear'
          : nursysResult.status === 'revoked' || nursysResult.status === 'surrendered'
          ? 'flagged'
          : nursysResult.status === 'unverified'
          ? 'unverified'
          : nursysResult.status === 'error'
          ? 'error'
          : 'unverified'

      checks.push({
        type: 'nursys_license',
        result: verificationResult,
        credentialId: cred.id,
        licenseNumber: cred.number!,
        issuingState: cred.issuing_state ?? undefined,
        status: nursysResult.status,
        note: nursysResult.note,
        checked_at: nursysResult.checked_at,
        source: 'NURSYS',
      })

      // Update credential status in DB
      await updateCredentialStatus(supabase, cred.id, nursysResult)
    }

    // ── 4. OIG check (always run, regardless of credentials) ──────────────────
    const oigResult: OIGResult = await checkOIGExclusion({
      firstName,     // PHI — used for check only, not logged
      lastName,      // PHI — used for check only, not logged
      nurseId,
      facilityId,
    })

    const oigVerificationResult: VerificationResult =
      oigResult.status === 'excluded'
        ? 'flagged'
        : oigResult.status === 'clear'
        ? 'clear'
        : 'unverified'

    checks.push({
      type: 'oig_exclusion',
      result: oigVerificationResult,
      status: oigResult.status,
      note: oigResult.note,
      checked_at: oigResult.checked_at,
      source: 'OIG_LEIE',
    })

    // ── 5. Flag detection and alert creation ───────────────────────────────────
    const flaggedChecks = checks.filter((c) => c.result === 'flagged')
    const flagsFound = flaggedChecks.length

    if (flagsFound > 0) {
      await createSanctionAlert(supabase, nurseId, facilityId, {
        checks_flagged: flaggedChecks.map((c) => ({
          type: c.type,
          source: c.source,
          status: c.status,
          licenseNumber: c.licenseNumber,
          issuingState: c.issuingState,
          // No names in evidence
        })),
        verification_run_at: completed_at,
      })
    }

    // ── 6. Compute overall status ──────────────────────────────────────────────
    const hasFlag = flagsFound > 0
    const hasUnverified = checks.some((c) => c.result === 'unverified' || c.result === 'error')
    const allClear = checks.every((c) => c.result === 'clear')

    const overall: OverallVerificationStatus = hasFlag
      ? 'flagged'
      : allClear
      ? 'clear'
      : 'partial'

    const checksRun = checks.length

    // ── 7. Audit log ───────────────────────────────────────────────────────────
    await writeAuditLog({
      actor_id: requestingAdminId ?? null,
      facility_id: facilityId,
      action: 'verification.run_complete',
      target_id: nurseId,
      target_type: 'nurse',
      metadata: {
        checks_run: checksRun,
        flags_found: flagsFound,
        has_unverified: hasUnverified,
        overall,
        check_types: checks.map((c) => c.type),
        // No names, no PHI
      },
    })

    return {
      nurseId,
      facilityId,
      overall,
      checksRun,
      flagsFound,
      checks,
      completed_at,
    }
  } catch (err) {
    console.error('[Verification] Unexpected error in runNurseVerification:', err)

    // Audit log the failure (still PHI-safe)
    await writeAuditLog({
      actor_id: requestingAdminId ?? null,
      facility_id: facilityId,
      action: 'verification.run_failed',
      target_id: nurseId,
      target_type: 'nurse',
      metadata: { error: String(err) },
    }).catch(() => {})

    return {
      nurseId,
      facilityId,
      overall: 'partial',
      checksRun: checks.length,
      flagsFound: 0,
      checks,
      completed_at,
    }
  }
}

// ── Export for tests ───────────────────────────────────────────────────────────

export { parseFullName }
