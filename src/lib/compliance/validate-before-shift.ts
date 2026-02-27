/**
 * Shift-Time Revalidation
 * NurseSphere TIER 1 — Continuous Compliance Engine
 *
 * Runs immediately before a nurse starts a shift.
 * Blocks shift start if any critical compliance issue is detected.
 *
 * Checks performed:
 *   1. Nurse status (must be 'active')
 *   2. OIG exclusion (cached result < 4h old, otherwise re-fetches)
 *   3. License expiry/revocation (from credential_verifications, last sweep data)
 *
 * PHI rules:
 *   - No patient data
 *   - Names used only as parameters to OIG API, never stored
 *   - audit_log: actor_id only
 *
 * Server-side only.
 */

import { createClient } from '@supabase/supabase-js'
import { checkOIGExclusion } from '@/lib/verification/oig-checker'
import { writeAuditLog } from '@/lib/audit'
import { sendPushToFacilityAdmins } from '@/lib/notifications/push-sender'

// ── Supabase admin client ──────────────────────────────────────────────────────

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role env vars')
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  allowed: boolean
  shiftId: string
  nurseId?: string
  reason?: string
  blockers: string[]
  checkedAt: string
}

export interface RevalidationHistoryEntry {
  id: string
  shift_id: string
  nurse_id: string
  allowed: boolean
  blockers: string[]
  checked_at: string
}

// ── OIG cache helper ───────────────────────────────────────────────────────────

const OIG_CACHE_HOURS = 4

/**
 * Returns cached OIG result if < 4h old, otherwise fetches fresh.
 */
async function getOIGResultCached(params: {
  nurseId: string
  firstName: string
  lastName: string
  facilityId?: string
}): Promise<{ excluded: boolean; source: string; checked_at: string }> {
  const supabase = getAdminClient()

  // Look for a recent OIG verification in credential_verifications
  const fourHoursAgo = new Date(Date.now() - OIG_CACHE_HOURS * 60 * 60 * 1000).toISOString()

  const { data: cached } = await supabase
    .from('credential_verifications')
    .select('result, raw_response, verified_at')
    .eq('nurse_id', params.nurseId)
    .eq('verification_type', 'oig_exclusion')
    .gte('verified_at', fourHoursAgo)
    .order('verified_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (cached) {
    const rawResp = (cached.raw_response ?? {}) as Record<string, unknown>
    return {
      excluded: cached.result === 'flagged',
      source: 'OIG_LEIE_CACHED',
      checked_at: cached.verified_at,
    }
  }

  // No fresh cache — do live check
  const result = await checkOIGExclusion({
    firstName: params.firstName,
    lastName: params.lastName,
    nurseId: params.nurseId,
    facilityId: params.facilityId,
  })

  return {
    excluded: result.excluded,
    source: result.source,
    checked_at: result.checked_at,
  }
}

// ── validateBeforeShift ────────────────────────────────────────────────────────

/**
 * validateBeforeShift
 *
 * Runs all compliance checks before a nurse can start a shift.
 * Returns { allowed: true } on success or { allowed: false, blockers[] } on failure.
 */
export async function validateBeforeShift(shiftId: string): Promise<ValidationResult> {
  const supabase = getAdminClient()
  const checkedAt = new Date().toISOString()
  const blockers: string[] = []

  // ── 1. Fetch shift + nurse assignment ────────────────────────────────────────
  const { data: shift, error: shiftError } = await supabase
    .from('shifts')
    .select('id, facility_id, status')
    .eq('id', shiftId)
    .maybeSingle()

  if (shiftError || !shift) {
    return {
      allowed: false,
      shiftId,
      reason: 'Shift not found',
      blockers: ['shift_not_found'],
      checkedAt,
    }
  }

  // Find nurse assignment for this shift
  const { data: assignment } = await supabase
    .from('shift_assignments')
    .select('nurse_id')
    .eq('shift_id', shiftId)
    .maybeSingle()

  if (!assignment?.nurse_id) {
    return {
      allowed: false,
      shiftId,
      reason: 'No nurse assigned to shift',
      blockers: ['no_nurse_assigned'],
      checkedAt,
    }
  }

  const nurseId = assignment.nurse_id

  // Fetch nurse profile (explicit columns — no PHI)
  const { data: nurse } = await supabase
    .from('profiles')
    .select('id, status, first_name, last_name, facility_id')
    .eq('id', nurseId)
    .maybeSingle()

  if (!nurse) {
    return {
      allowed: false,
      shiftId,
      nurseId,
      reason: 'Nurse profile not found',
      blockers: ['nurse_not_found'],
      checkedAt,
    }
  }

  // ── 2. Check nurse status ─────────────────────────────────────────────────────
  if (nurse.status !== 'active') {
    blockers.push(`nurse_status_${nurse.status}`)
  }

  // ── 3. OIG check (cached < 4h) ────────────────────────────────────────────────
  const oigResult = await getOIGResultCached({
    nurseId,
    firstName: nurse.first_name ?? 'Unknown',
    lastName: nurse.last_name ?? 'Unknown',
    facilityId: shift.facility_id ?? undefined,
  })

  if (oigResult.excluded) {
    blockers.push('oig_exclusion_hit')
  }

  // ── 4. License check (from most recent credential_verifications) ───────────────
  const { data: licenseVerifications } = await supabase
    .from('credential_verifications')
    .select('result, raw_response, verified_at')
    .eq('nurse_id', nurseId)
    .eq('verification_type', 'nursys_license')
    .order('verified_at', { ascending: false })
    .limit(5)

  if (licenseVerifications && licenseVerifications.length > 0) {
    // Check most recent verification per license — if any is revoked/expired, block
    const badLicense = licenseVerifications.find((v) => {
      const raw = (v.raw_response ?? {}) as Record<string, unknown>
      const status = raw.status as string | undefined
      return status === 'revoked' || status === 'surrendered' || status === 'expired'
    })
    if (badLicense) {
      const raw = (badLicense.raw_response ?? {}) as Record<string, unknown>
      blockers.push(`license_${raw.status ?? 'invalid'}`)
    }
  }

  // Check credentials table directly for expired licenses
  const { data: credentials } = await supabase
    .from('credentials')
    .select('id, type, status, expiration_date')
    .eq('nurse_id', nurseId)
    .in('type', ['RN_LICENSE', 'LPN_LICENSE', 'APRN_LICENSE'])

  if (credentials) {
    const now = new Date()
    for (const cred of credentials) {
      if (cred.status === 'expired' || new Date(cred.expiration_date) < now) {
        if (!blockers.some((b) => b.startsWith('license_'))) {
          blockers.push('license_expired')
        }
      }
    }
  }

  // ── 5. Handle result ──────────────────────────────────────────────────────────
  if (blockers.length > 0) {
    // Block the shift
    await supabase
      .from('shifts')
      .update({ status: 'blocked' })
      .eq('id', shiftId)

    await writeAuditLog({
      actor_id: nurseId,
      facility_id: shift.facility_id,
      action: 'shift.blocked_on_revalidation',
      target_id: shiftId,
      target_type: 'shift',
      metadata: { shiftId, blockers, nurse_id: nurseId },
    })

    // Notify facility admin
    if (shift.facility_id) {
      await sendPushToFacilityAdmins(shift.facility_id, {
        title: 'Shift Blocked: Compliance Failure',
        body: 'A nurse failed pre-shift compliance validation. Shift has been blocked.',
        data: { type: 'shift_blocked', shiftId, nurseId },
      }).catch(() => {})
    }

    return {
      allowed: false,
      shiftId,
      nurseId,
      reason: `Compliance check failed: ${blockers.join(', ')}`,
      blockers,
      checkedAt,
    }
  }

  // ── 6. All passed ─────────────────────────────────────────────────────────────
  await writeAuditLog({
    actor_id: nurseId,
    facility_id: shift.facility_id,
    action: 'shift.revalidation_passed',
    target_id: shiftId,
    target_type: 'shift',
    metadata: { shiftId, nurse_id: nurseId },
  })

  return {
    allowed: true,
    shiftId,
    nurseId,
    blockers: [],
    checkedAt,
  }
}

// ── getRevalidationHistory ─────────────────────────────────────────────────────

/**
 * getRevalidationHistory
 *
 * Returns the audit log history for a given shift's revalidation events.
 * No PHI in returned data.
 */
export async function getRevalidationHistory(shiftId: string): Promise<RevalidationHistoryEntry[]> {
  const supabase = getAdminClient()

  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, action, target_id, metadata, created_at')
    .eq('target_id', shiftId)
    .in('action', ['shift.blocked_on_revalidation', 'shift.revalidation_passed'])
    .order('created_at', { ascending: false })
    .limit(20)

  if (error || !data) {
    console.warn('[ValidateBeforeShift] getRevalidationHistory failed for shift %s: %s', shiftId, error?.message)
    return []
  }

  return data.map((row) => {
    const meta = (row.metadata ?? {}) as Record<string, unknown>
    return {
      id: row.id,
      shift_id: shiftId,
      nurse_id: (meta.nurse_id as string) ?? '',
      allowed: row.action === 'shift.revalidation_passed',
      blockers: (meta.blockers as string[]) ?? [],
      checked_at: row.created_at,
    }
  })
}
