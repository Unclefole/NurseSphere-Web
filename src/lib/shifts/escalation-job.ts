/**
 * Shift Escalation Job — MODULE 2
 * Recomputes shift risk on create/update and hourly for upcoming shifts.
 * NEVER auto-increases rate — only logs recommendations for human review.
 * HIPAA: no PHI in audit logs, facility_id scoped.
 */
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { writeAuditLog } from '@/lib/audit'
import { notifyShiftHighRisk } from '@/lib/notifications/notification-service'
import {
  computeAcceptanceProbability,
  computeFitScore,
  computeShiftRisk,
  rankCandidates,
  NurseInput,
  ShiftInput,
} from './fill-predictor'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DBShift {
  id: string
  facility_id: string
  start_time: string
  hourly_rate: number
  required_credentials?: string[] | null
}

interface DBNurse {
  id: string
  compliance_score?: number | null
  historical_acceptance_rate?: number | null
  credentials?: string[] | null
}

interface DBCostBaseline {
  value: number
}

// ─── Fetch Helpers ────────────────────────────────────────────────────────────

async function fetchShift(shiftId: string): Promise<DBShift | null> {
  const supabase = createSupabaseAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('shifts')
    .select('id, facility_id, start_time, hourly_rate')
    .eq('id', shiftId)
    .single()

  if (error || !data) return null
  return data as DBShift
}

async function fetchNursesForFacility(facilityId: string): Promise<NurseInput[]> {
  const supabase = createSupabaseAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('profiles')
    .select('id, compliance_score, historical_acceptance_rate')
    .eq('role', 'nurse')

  if (error || !data) return []

  return (data as DBNurse[]).map(n => ({
    id: n.id,
    compliance_score: n.compliance_score ?? 75,
    historical_acceptance_rate: n.historical_acceptance_rate ?? null,
    credentials: n.credentials ?? [],
  }))
}

async function fetchFacilityBaselineRate(facilityId: string): Promise<number> {
  const supabase = createSupabaseAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('cost_baselines')
    .select('value')
    .eq('facility_id', facilityId)
    .eq('baseline_type', 'agency_avg_rate')
    .single()

  const baseline = data as DBCostBaseline | null
  return baseline?.value ?? 75
}

// ─── Persist Results ──────────────────────────────────────────────────────────

async function persistRiskAndCandidates(
  shift: ShiftInput,
  nurses: NurseInput[],
  facilityBaselineRate: number
) {
  const supabase = createSupabaseAdminClient()

  const candidates = rankCandidates(shift, nurses, facilityBaselineRate)
  const risk = computeShiftRisk(shift, candidates, facilityBaselineRate)

  // Upsert shift_risk
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('shift_risk')
    .upsert(
      {
        shift_id: risk.shift_id,
        facility_id: risk.facility_id,
        fill_probability: risk.fill_probability,
        risk_level: risk.risk_level,
        recommended_rate_delta: risk.recommended_rate_delta,
        recommended_actions: risk.recommended_actions,
        computed_at: risk.computed_at,
      },
      { onConflict: 'shift_id' }
    )

  // Upsert candidates (top 20)
  if (candidates.length > 0) {
    const rows = candidates.map(c => ({
      shift_id: c.shift_id,
      nurse_id: c.nurse_id,
      facility_id: c.facility_id,
      score_accept: c.score_accept,
      score_fit: c.score_fit,
      rank: c.rank,
      reasons: c.reasons,
    }))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('shift_candidates')
      .upsert(rows, { onConflict: 'shift_id,nurse_id' })
  }

  // Audit high-risk shifts — NEVER auto-increase rate, only log recommendation
  if (risk.risk_level === 'high') {
    await writeAuditLog({
      actor_id: null,  // system-initiated
      action: 'shift.risk.high_detected',
      target_type: 'shift',
      target_id: shift.id,
      facility_id: shift.facility_id,
      metadata: {
        fill_probability: risk.fill_probability,
        recommended_rate_delta: risk.recommended_rate_delta,
        recommended_actions: risk.recommended_actions,
        // HIPAA: no nurse names/IDs in high-level audit
        candidate_count: candidates.length,
      },
    })

    // Notify facility admins via email — fire-and-forget, non-fatal
    notifyShiftHighRisk(shift.facility_id, shift.id, risk.fill_probability).catch(
      () => { /* swallow */ }
    )
  }

  return { risk, candidates }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Recompute risk for a single shift (call on shift create/update).
 */
export async function recomputeShiftRisk(shiftId: string): Promise<void> {
  try {
    const dbShift = await fetchShift(shiftId)
    if (!dbShift) {
      console.warn(`[EscalationJob] Shift ${shiftId} not found, skipping.`)
      return
    }

    const shift: ShiftInput = {
      id: dbShift.id,
      facility_id: dbShift.facility_id,
      start_time: dbShift.start_time,
      hourly_rate: dbShift.hourly_rate,
      required_credentials: dbShift.required_credentials ?? [],
    }

    const nurses = await fetchNursesForFacility(dbShift.facility_id)
    const baselineRate = await fetchFacilityBaselineRate(dbShift.facility_id)

    await persistRiskAndCandidates(shift, nurses, baselineRate)
  } catch (err) {
    // Never throw — this is a background job
    console.error(`[EscalationJob] recomputeShiftRisk(${shiftId}) failed:`, err)
  }
}

/**
 * Recompute risk for all open shifts starting within the next 72 hours.
 * Intended to run hourly via cron.
 * NEVER auto-increases rate — only logs recommendations.
 */
export async function recomputeUpcomingShiftRisks(): Promise<{
  processed: number
  errors: number
}> {
  let processed = 0
  let errors = 0

  try {
    const supabase = createSupabaseAdminClient()
    const now = new Date()
    const in72h = new Date(now.getTime() + 72 * 60 * 60 * 1000)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shifts, error } = await (supabase as any)
      .from('shifts')
      .select('id, facility_id, start_time, hourly_rate')
      .eq('status', 'open')
      .gte('start_time', now.toISOString())
      .lte('start_time', in72h.toISOString())

    if (error) {
      console.error('[EscalationJob] Failed to fetch upcoming shifts:', error)
      return { processed, errors: 1 }
    }

    const dbShifts = (shifts ?? []) as DBShift[]
    for (const dbShift of dbShifts) {
      try {
        const shift: ShiftInput = {
          id: dbShift.id,
          facility_id: dbShift.facility_id,
          start_time: dbShift.start_time,
          hourly_rate: dbShift.hourly_rate,
          required_credentials: dbShift.required_credentials ?? [],
        }
        const nurses = await fetchNursesForFacility(dbShift.facility_id)
        const baselineRate = await fetchFacilityBaselineRate(dbShift.facility_id)
        await persistRiskAndCandidates(shift, nurses, baselineRate)
        processed++
      } catch (err) {
        console.error(`[EscalationJob] Failed for shift ${dbShift.id}:`, err)
        errors++
      }
    }

    console.info(`[EscalationJob] Processed ${processed} shifts, ${errors} errors.`)
  } catch (err) {
    console.error('[EscalationJob] Unexpected error:', err)
    errors++
  }

  return { processed, errors }
}
