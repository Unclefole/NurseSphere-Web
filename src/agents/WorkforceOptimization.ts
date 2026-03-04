/**
 * WorkforceOptimization Agent
 *
 * Computes shortage risk and cancellation trends per facility using the last 7 days
 * of facility_metrics data.
 *
 * Algorithm (deterministic):
 *   fillRate7d     = sum(filled_shifts) / sum(requested_shifts) over last 7 days
 *   shortage risk  = HIGH if fillRate7d < 0.80
 *   cancellation   = RISING if avg(canceled, last 3d) > avg(canceled, prior 4d) by >10%
 *
 * Emits SHORTAGE_RISK alerts for HIGH and CRITICAL risk levels.
 * Writes daily facility_metrics rollup from shifts table if row doesn't exist for today.
 *
 * PHI rules:
 *   - No nurse-level data in this agent — aggregate facility metrics only
 *   - No nurse UUIDs in alerts payload
 *   - Never log tokens or secrets
 *
 * Server-side only.
 */

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import type {
  AgentInterface,
  AgentInput,
  AgentOutput,
  WorkforceOptimizationResult,
  RiskLevel,
  CancellationTrend,
  AgentAlertSeverity,
} from './core/types'
import { emitAlert } from './core/alerts'

// ── Supabase admin client ──────────────────────────────────────────────────────

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role env vars')
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ── Risk classification ────────────────────────────────────────────────────────

function classifyRisk(fillRate: number): RiskLevel {
  if (fillRate >= 0.90) return 'LOW'
  if (fillRate >= 0.80) return 'MED'
  if (fillRate >= 0.60) return 'HIGH'
  return 'CRITICAL'
}

function classifyTrend(recent3: number, prior4: number): CancellationTrend {
  if (prior4 === 0 && recent3 === 0) return 'STABLE'
  if (prior4 === 0) return 'RISING'
  const change = (recent3 - prior4) / prior4
  if (change > 0.10)  return 'RISING'
  if (change < -0.10) return 'FALLING'
  return 'STABLE'
}

function avg(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

// ── Metrics row type ───────────────────────────────────────────────────────────

interface MetricsRow {
  date: string
  requested_shifts: number
  filled_shifts: number
  canceled_shifts: number
  avg_time_to_fill_minutes: number | null
}

// ── Main agent class ───────────────────────────────────────────────────────────

export class WorkforceOptimization implements AgentInterface {
  readonly name = 'WorkforceOptimization' as const

  async run(input: AgentInput): Promise<AgentOutput> {
    const runId = input.runId ?? randomUUID()
    const startedAt = new Date().toISOString()

    try {
      const result = await this._analyze(input)

      return {
        agentName: this.name,
        runId,
        success: true,
        startedAt,
        completedAt: new Date().toISOString(),
        result,
      }
    } catch (err) {
      return {
        agentName: this.name,
        runId,
        success: false,
        startedAt,
        completedAt: new Date().toISOString(),
        result: null,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  private async _analyze(input: AgentInput): Promise<WorkforceOptimizationResult> {
    const { facilityId } = input
    if (!facilityId) throw new Error('WorkforceOptimization: facilityId is required')

    const supabase = getAdminClient()

    // ── 1. Upsert today's daily metrics rollup from shifts table ───────────────
    await this._upsertTodayMetrics(supabase, facilityId)

    // ── 2. Load last 7 days of facility_metrics ────────────────────────────────
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0]

    const { data: rows, error } = await supabase
      .from('facility_metrics')
      .select('date, requested_shifts, filled_shifts, canceled_shifts, avg_time_to_fill_minutes')
      .eq('facility_id', facilityId)
      .gte('date', sevenDaysAgoStr)
      .order('date', { ascending: true })

    if (error) throw new Error(`Failed to load facility_metrics: ${error.message}`)

    const metrics: MetricsRow[] = rows ?? []

    // ── 3. Compute fill rate over 7 days ──────────────────────────────────────
    const totalRequested = metrics.reduce((s, r) => s + (r.requested_shifts ?? 0), 0)
    const totalFilled    = metrics.reduce((s, r) => s + (r.filled_shifts ?? 0), 0)
    const fillRate7d     = totalRequested === 0 ? 1.0 : totalFilled / totalRequested

    // ── 4. Compute cancellation trend ─────────────────────────────────────────
    // Split into last 3 days and prior 4 days
    const sorted  = [...metrics].sort((a, b) => a.date.localeCompare(b.date))
    const recent3 = sorted.slice(-3).map((r) => r.canceled_shifts ?? 0)
    const prior4  = sorted.slice(0, Math.max(0, sorted.length - 3)).map((r) => r.canceled_shifts ?? 0)

    const cancellationTrend = classifyTrend(avg(recent3), avg(prior4))

    // ── 5. Classify risk ──────────────────────────────────────────────────────
    let riskLevel = classifyRisk(fillRate7d)

    // Escalate if both fill rate is borderline MED and trend is RISING
    if (riskLevel === 'MED' && cancellationTrend === 'RISING') {
      riskLevel = 'HIGH'
    }

    // ── 6. Emit alert if HIGH or CRITICAL ────────────────────────────────────
    if (riskLevel === 'HIGH' || riskLevel === 'CRITICAL') {
      const severity: AgentAlertSeverity = riskLevel === 'CRITICAL' ? 'HIGH' : 'MED'

      // Alert targets the facility — use facilityId as userId proxy
      // (facility admins are notified via a separate notification layer)
      await emitAlert({
        userId: facilityId,
        type: 'SHORTAGE_RISK',
        severity,
        payload: {
          agentName: this.name,
          facilityId,
          fillRate7d: Math.round(fillRate7d * 1000) / 1000,
          cancellationTrend,
          riskLevel,
          totalRequested,
          totalFilled,
        },
      })
    }

    return {
      facilityId,
      fillRate7d: Math.round(fillRate7d * 1000) / 1000,
      cancellationTrend,
      riskLevel,
    }
  }

  /**
   * Upsert today's daily metrics row from live shifts data.
   * Called before reading metrics so today's data is always current.
   * Phantom-guarded: if shifts table doesn't exist yet, silently skips.
   */
  private async _upsertTodayMetrics(
    supabase: ReturnType<typeof getAdminClient>,
    facilityId: string,
  ): Promise<void> {
    try {
      const today = new Date().toISOString().split('T')[0]

      // Count shifts by status for today
      const { data: shifts, error } = await supabase
        .from('shifts')
        .select('id, status, created_at')
        .eq('facility_id', facilityId)
        .gte('created_at', `${today}T00:00:00.000Z`)
        .lte('created_at', `${today}T23:59:59.999Z`)

      if (error) {
        console.warn('[WorkforceOptimization] Could not load shifts for today:', error.message)
        return
      }

      const shiftRows = shifts ?? []
      const requested = shiftRows.length
      const filled    = shiftRows.filter((s) => s.status === 'filled' || s.status === 'completed').length
      const canceled  = shiftRows.filter((s) => s.status === 'cancelled').length

      // Upsert today's row (insert or update)
      const { error: upsertErr } = await supabase
        .from('facility_metrics')
        .upsert(
          {
            facility_id: facilityId,
            date: today,
            requested_shifts: requested,
            filled_shifts: filled,
            canceled_shifts: canceled,
            avg_time_to_fill_minutes: null,  // not computed in V1
            created_at: new Date().toISOString(),
          },
          { onConflict: 'facility_id,date' }
        )

      if (upsertErr) {
        console.warn('[WorkforceOptimization] Metrics upsert failed (table may not exist yet):', upsertErr.message)
      }
    } catch (err) {
      // Phantom guard — never crash the agent on metrics upsert failure
      console.warn('[WorkforceOptimization] Metrics upsert error:', (err as Error).message)
    }
  }
}

// ── Daily optimization sweep — runs for all active facilities ──────────────────

export async function runDailyWorkforceOptimization(): Promise<{
  facilitiesAnalyzed: number
  highRisk: number
  criticalRisk: number
  errors: number
}> {
  const supabase = getAdminClient()
  const { AgentRunner } = await import('./core/AgentRunner')

  const { data: facilities, error } = await supabase
    .from('facilities')
    .select('id')

  if (error) throw new Error(`Failed to load facilities: ${error.message}`)

  const allFacilities = facilities ?? []
  const runner = new AgentRunner()
  runner.register(new WorkforceOptimization())

  let highRisk = 0, criticalRisk = 0, errors = 0

  for (const facility of allFacilities) {
    const output = await runner.run({
      agentName: 'WorkforceOptimization',
      mode: 'daily',
      facilityId: facility.id,
    })

    if (!output.success) {
      errors++
      continue
    }

    const result = output.result as WorkforceOptimizationResult
    if (result.riskLevel === 'HIGH')     highRisk++
    if (result.riskLevel === 'CRITICAL') criticalRisk++
  }

  return {
    facilitiesAnalyzed: allFacilities.length,
    highRisk,
    criticalRisk,
    errors,
  }
}
