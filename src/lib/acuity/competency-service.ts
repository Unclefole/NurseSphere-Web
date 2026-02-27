/**
 * Competency Service — NurseSphere TIER 3
 *
 * Manages nurse unit-type competencies: scoring, recency, CRUD.
 *
 * Competency Scoring Formula:
 *   Base score  : (min(hours_last_12mo, 500) / 500) * 60  → 0–60 points
 *   Recency     : recencyIndex * 30                        → 0–30 points
 *   Verified    : verified ? 10 : 0                        → 0–10 points
 *   Total       : 0–100
 *
 * Recency Index (0–1):
 *   null / never worked      → 0
 *   worked last 30 days      → 1.0
 *   worked 1–3 months ago    → 0.75
 *   worked 3–6 months ago    → 0.5
 *   worked 6–12 months ago   → 0.25
 *   worked 12+ months ago    → 0
 */
import { createClient } from '@supabase/supabase-js'
import { writeAuditLog } from '@/lib/audit'

// ─── Types ─────────────────────────────────────────────────────────────────

export type UnitType =
  | 'ICU' | 'ER' | 'MedSurg' | 'Tele' | 'NICU' | 'PICU'
  | 'OR' | 'L&D' | 'Psych' | 'Oncology' | 'StepDown' | 'Float'

export const UNIT_TYPES: UnitType[] = [
  'ICU', 'ER', 'MedSurg', 'Tele', 'NICU', 'PICU',
  'OR', 'L&D', 'Psych', 'Oncology', 'StepDown', 'Float',
]

export interface Competency {
  id: string
  nurse_id: string
  unit_type: UnitType
  last_worked_at: string | null
  hours_last_12mo: number
  verified: boolean
  verified_at: string | null
  verified_by: string | null
  recency_index: number
  competency_score: number
  created_at: string
  updated_at: string
}

// ─── Supabase client (service role) ────────────────────────────────────────

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ─── Scoring Functions ──────────────────────────────────────────────────────

/**
 * Compute the recency index (0–1 scale) based on when the nurse last worked
 * in a given unit type.
 */
export function computeRecencyIndex(lastWorkedAt: Date | null): number {
  if (!lastWorkedAt) return 0

  const now = new Date()
  const diffMs = now.getTime() - lastWorkedAt.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)

  if (diffDays <= 30) return 1.0
  if (diffDays <= 90) return 0.75    // 1–3 months
  if (diffDays <= 180) return 0.5    // 3–6 months
  if (diffDays <= 365) return 0.25   // 6–12 months
  return 0                            // 12+ months
}

/**
 * Compute the overall competency score (0–100).
 *
 * Formula:
 *   Base     = (min(hours, 500) / 500) * 60  →  0–60 points
 *   Recency  = recencyIndex * 30             →  0–30 points
 *   Verified = verified ? 10 : 0             →  0–10 points
 */
export function computeCompetencyScore(
  hours: number,
  recencyIndex: number,
  verified: boolean
): number {
  const cappedHours = Math.min(Math.max(hours, 0), 500)
  const baseScore = (cappedHours / 500) * 60
  const recencyScore = recencyIndex * 30
  const verifiedBonus = verified ? 10 : 0
  return Math.round((baseScore + recencyScore + verifiedBonus) * 100) / 100
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

/**
 * Fetch all competencies for a nurse.
 */
export async function getNurseCompetencies(nurseId: string): Promise<Competency[]> {
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('competencies')
    .select('id, nurse_id, unit_type, last_worked_at, hours_last_12mo, verified, verified_at, verified_by, recency_index, competency_score, created_at, updated_at')
    .eq('nurse_id', nurseId)
    .order('unit_type')

  if (error) {
    console.error('[CompetencyService] getNurseCompetencies error:', error.message)
    throw new Error(`Failed to fetch competencies: ${error.message}`)
  }

  return (data ?? []) as Competency[]
}

/**
 * Fetch a single competency record for a nurse in a specific unit type.
 */
export async function getNurseCompetencyForUnit(
  nurseId: string,
  unitType: UnitType
): Promise<Competency | null> {
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('competencies')
    .select('id, nurse_id, unit_type, last_worked_at, hours_last_12mo, verified, verified_at, verified_by, recency_index, competency_score, created_at, updated_at')
    .eq('nurse_id', nurseId)
    .eq('unit_type', unitType)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // not found
    console.error('[CompetencyService] getNurseCompetencyForUnit error:', error.message)
    throw new Error(`Failed to fetch competency: ${error.message}`)
  }

  return data as Competency
}

/**
 * Upsert a competency record for a nurse.
 * Automatically computes recency_index and competency_score.
 * Creates audit log entry.
 */
export async function upsertCompetency(
  nurseId: string,
  unitType: UnitType,
  hours: number,
  lastWorkedAt: Date | null,
  verifiedBy?: string
): Promise<Competency> {
  const supabase = getServiceClient()

  const recencyIndex = computeRecencyIndex(lastWorkedAt)
  const verified = !!verifiedBy
  const competencyScore = computeCompetencyScore(hours, recencyIndex, verified)

  const payload: Record<string, unknown> = {
    nurse_id: nurseId,
    unit_type: unitType,
    hours_last_12mo: hours,
    last_worked_at: lastWorkedAt ? lastWorkedAt.toISOString() : null,
    recency_index: recencyIndex,
    competency_score: competencyScore,
    verified: verified,
    verified_at: verified ? new Date().toISOString() : null,
    verified_by: verifiedBy ?? null,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('competencies')
    .upsert(payload, { onConflict: 'nurse_id,unit_type' })
    .select()
    .single()

  if (error) {
    console.error('[CompetencyService] upsertCompetency error:', error.message)
    throw new Error(`Failed to upsert competency: ${error.message}`)
  }

  // Audit log
  await writeAuditLog({
    actor_id: verifiedBy ?? nurseId,
    action: 'competency.updated',
    target_type: 'competency',
    target_id: (data as Competency).id,
    metadata: {
      nurse_id: nurseId,
      unit_type: unitType,
      hours_last_12mo: hours,
      competency_score: competencyScore,
      recency_index: recencyIndex,
      verified,
    },
  })

  return data as Competency
}
