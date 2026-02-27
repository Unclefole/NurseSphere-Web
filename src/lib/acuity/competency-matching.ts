/**
 * Competency Matching Guardrail — NurseSphere TIER 3
 *
 * Validates whether a nurse meets the competency requirements for a shift.
 * HIGH/CRITICAL shifts BLOCK nurses below threshold.
 * MODERATE shifts warn but allow.
 * LOW/null shifts always allow.
 *
 * Admin override requires written justification (min 20 chars) and is audit-logged.
 */
import { createClient } from '@supabase/supabase-js'
import { writeAuditLog } from '@/lib/audit'
import { getNurseCompetencyForUnit } from '@/lib/acuity/competency-service'
import type { UnitType, Competency } from '@/lib/acuity/competency-service'
import crypto from 'crypto'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CompetencyBlocker {
  unit_type: UnitType
  required_score: number
  nurse_score: number
  shortfall: number
}

export type MatchResult =
  | {
      allowed: true
      competencySnapshot: Competency[]
      warnings?: string[]
    }
  | {
      allowed: false
      reason: string
      blockers: CompetencyBlocker[]
      requiresOverride: true
    }

export interface OverrideResult {
  overrideToken: string
  shiftId: string
  nurseId: string
  adminId: string
  justification: string
  issuedAt: string
}

// ─── Supabase client ────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate whether a nurse is competent to accept a shift.
 *
 * Rules by acuity level:
 *   null / 'low'     → always allow
 *   'moderate'       → warn if score < threshold, but allow
 *   'high'/'critical' → BLOCK if any required competency score < threshold
 */
export async function validateCompetencyMatch(
  nurseId: string,
  shiftId: string
): Promise<MatchResult> {
  const supabase = getServiceClient()

  // Fetch shift acuity data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: shiftRaw, error: shiftError } = await (supabase as any)
    .from('shifts')
    .select('id, acuity_level, required_competencies, minimum_competency_score')
    .eq('id', shiftId)
    .single()

  if (shiftError || !shiftRaw) {
    throw new Error(`Shift not found: ${shiftId}`)
  }

  const shift = shiftRaw as {
    id: string
    acuity_level: string | null
    required_competencies: UnitType[]
    minimum_competency_score: number
  }

  // Low or no acuity — always allow
  if (!shift.acuity_level || shift.acuity_level === 'low') {
    await writeAuditLog({
      actor_id: nurseId,
      action: 'shift.competency_validated',
      target_type: 'shift',
      target_id: shiftId,
      metadata: { nurse_id: nurseId, acuity_level: shift.acuity_level ?? 'none', result: 'allowed' },
    })
    return { allowed: true, competencySnapshot: [] }
  }

  const requiredUnits: UnitType[] = shift.required_competencies ?? []
  const threshold = shift.minimum_competency_score ?? 60

  // If no specific competencies required, allow with snapshot
  if (requiredUnits.length === 0) {
    await writeAuditLog({
      actor_id: nurseId,
      action: 'shift.competency_validated',
      target_type: 'shift',
      target_id: shiftId,
      metadata: { nurse_id: nurseId, acuity_level: shift.acuity_level, result: 'allowed_no_requirements' },
    })
    return { allowed: true, competencySnapshot: [] }
  }

  // Fetch nurse competencies for each required unit
  const competencySnapshot: Competency[] = []
  const blockers: CompetencyBlocker[] = []
  const warnings: string[] = []

  for (const unitType of requiredUnits) {
    const comp = await getNurseCompetencyForUnit(nurseId, unitType)
    const score = comp?.competency_score ?? 0

    if (comp) competencySnapshot.push(comp)

    if (score < threshold) {
      const blocker: CompetencyBlocker = {
        unit_type: unitType,
        required_score: threshold,
        nurse_score: score,
        shortfall: threshold - score,
      }

      if (shift.acuity_level === 'moderate') {
        warnings.push(
          `${unitType}: score ${score} is below threshold ${threshold}. Proceeding with warning.`
        )
      } else {
        // high or critical — block
        blockers.push(blocker)
      }
    }
  }

  // Blocked?
  if (blockers.length > 0) {
    await writeAuditLog({
      actor_id: nurseId,
      action: 'shift.competency_blocked',
      target_type: 'shift',
      target_id: shiftId,
      metadata: {
        nurse_id: nurseId,
        acuity_level: shift.acuity_level,
        blockers,
        threshold,
      },
    })

    return {
      allowed: false,
      reason: `Nurse does not meet competency requirements for ${shift.acuity_level.toUpperCase()} acuity shift. ${blockers.length} unit(s) below threshold.`,
      blockers,
      requiresOverride: true,
    }
  }

  // Allowed (possibly with moderate warnings)
  await writeAuditLog({
    actor_id: nurseId,
    action: 'shift.competency_validated',
    target_type: 'shift',
    target_id: shiftId,
    metadata: {
      nurse_id: nurseId,
      acuity_level: shift.acuity_level,
      result: 'allowed',
      warnings: warnings.length > 0 ? warnings : undefined,
    },
  })

  return {
    allowed: true,
    competencySnapshot,
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}

// ─── Admin Override ─────────────────────────────────────────────────────────

/**
 * Admin override for competency mismatch.
 * Requires written justification (min 20 characters).
 * Fully audit-logged.
 * Returns an override token to be passed into generateRiskCertificate().
 */
export async function adminOverrideCompetency(
  shiftId: string,
  nurseId: string,
  adminId: string,
  justification: string
): Promise<OverrideResult> {
  if (!justification || justification.trim().length < 20) {
    throw new Error(
      'Override justification must be at least 20 characters. Please provide a detailed reason.'
    )
  }

  const issuedAt = new Date().toISOString()

  // Generate a deterministic override token (non-secret — just for correlation)
  const overrideToken = crypto
    .createHash('sha256')
    .update(`${shiftId}:${nurseId}:${adminId}:${issuedAt}`)
    .digest('hex')
    .slice(0, 32)

  await writeAuditLog({
    actor_id: adminId,
    action: 'shift.competency_override',
    target_type: 'shift',
    target_id: shiftId,
    metadata: {
      shift_id: shiftId,
      nurse_id: nurseId,
      justification: justification.trim(),
      override_token: overrideToken,
    },
  })

  return {
    overrideToken,
    shiftId,
    nurseId,
    adminId,
    justification: justification.trim(),
    issuedAt,
  }
}
