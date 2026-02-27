/**
 * Labor Cost Calculator — MODULE 3
 * Computes shift savings, agency dependency ratios, and KPI aggregations.
 * HIPAA: No PHI processed here. Facility-scoped. Server-only.
 */
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShiftCostInput {
  hourly_rate: number
  hours: number
  event_type: 'staffed_internal' | 'staffed_nursesphere' | 'staffed_agency'
}

export interface ShiftCostResult {
  cost: number
  baseline_cost: number
  savings: number
}

export interface KPISnapshot {
  facility_id: string
  period_start: string
  period_end: string
  total_hours: number
  total_cost: number
  total_savings: number
  agency_dependency_ratio: number
  overtime_hours: number
  computed_at: string
}

export interface KPITrend {
  current: KPISnapshot | null
  previous: KPISnapshot | null
  savings_delta: number
  agency_ratio_delta: number
}

interface CostEventRow {
  hours: number
  cost: number
  baseline_cost: number
  savings: number
  event_type: string
}

interface BaselineRow {
  value: number
}

interface KPISnapshotRow {
  facility_id: string
  period_start: string
  period_end: string
  total_hours: number
  total_cost: number
  total_savings: number
  agency_dependency_ratio: number
  overtime_hours: number
  computed_at: string
}

// ─── Core Calculations ────────────────────────────────────────────────────────

/**
 * Compute cost, baseline_cost, and savings for a single shift.
 *
 * cost         = hourly_rate × hours
 * baseline_cost = agency_avg_rate × hours (or override per event_type)
 * savings      = baseline_cost - cost
 */
export function computeShiftCost(
  input: ShiftCostInput,
  agencyBaselineRate: number
): ShiftCostResult {
  const cost = input.hourly_rate * input.hours
  const baseline_cost = agencyBaselineRate * input.hours
  const savings = baseline_cost - cost
  return { cost, baseline_cost, savings }
}

// ─── Agency Dependency Ratio ──────────────────────────────────────────────────

/**
 * Ratio of agency-staffed hours to total hours in the given period.
 * Returns 0-1. Returns 0 if no events in the period.
 */
export async function computeAgencyDependencyRatio(
  facilityId: string,
  startDate: Date,
  endDate: Date
): Promise<number> {
  const supabase = createSupabaseAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('cost_events')
    .select('hours, event_type')
    .eq('facility_id', facilityId)
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString())

  if (error || !data) return 0

  const events = data as Array<{ hours: number; event_type: string }>
  const totalHours = events.reduce((sum, e) => sum + Number(e.hours), 0)
  if (totalHours === 0) return 0

  const agencyHours = events
    .filter(e => e.event_type === 'staffed_agency')
    .reduce((sum, e) => sum + Number(e.hours), 0)

  return agencyHours / totalHours
}

// ─── Fetch Baseline Rate ──────────────────────────────────────────────────────

export async function fetchAgencyBaselineRate(facilityId: string): Promise<number> {
  const supabase = createSupabaseAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('cost_baselines')
    .select('value')
    .eq('facility_id', facilityId)
    .eq('baseline_type', 'agency_avg_rate')
    .single()

  const row = data as BaselineRow | null
  return row?.value ? Number(row.value) : 75 // default $75/hr
}

// ─── KPI Aggregation ──────────────────────────────────────────────────────────

/**
 * Aggregate cost events into a KPI snapshot for a facility + period.
 * Upserts to kpi_snapshots table.
 */
export async function aggregateKPIs(
  facilityId: string,
  startDate: Date,
  endDate: Date
): Promise<KPISnapshot> {
  const supabase = createSupabaseAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: events, error } = await (supabase as any)
    .from('cost_events')
    .select('hours, cost, baseline_cost, savings, event_type')
    .eq('facility_id', facilityId)
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString())

  if (error) {
    throw new Error(`[CostCalculator] aggregateKPIs failed: ${error.message}`)
  }

  const rows = (events ?? []) as CostEventRow[]

  const totalHours = rows.reduce((s, e) => s + Number(e.hours), 0)
  const totalCost = rows.reduce((s, e) => s + Number(e.cost), 0)
  const totalSavings = rows.reduce((s, e) => s + Number(e.savings), 0)
  const agencyHours = rows
    .filter(e => e.event_type === 'staffed_agency')
    .reduce((s, e) => s + Number(e.hours), 0)
  const agencyDependencyRatio = totalHours > 0 ? agencyHours / totalHours : 0

  // For overtime: we don't have shift-level overtime flag yet, stub as 0
  const overtimeHours = 0

  const periodStart = startDate.toISOString().slice(0, 10)
  const periodEnd = endDate.toISOString().slice(0, 10)
  const computedAt = new Date().toISOString()

  const snapshot: KPISnapshot = {
    facility_id: facilityId,
    period_start: periodStart,
    period_end: periodEnd,
    total_hours: totalHours,
    total_cost: totalCost,
    total_savings: totalSavings,
    agency_dependency_ratio: agencyDependencyRatio,
    overtime_hours: overtimeHours,
    computed_at: computedAt,
  }

  // Upsert snapshot
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('kpi_snapshots')
    .upsert(
      {
        facility_id: facilityId,
        period_start: periodStart,
        period_end: periodEnd,
        total_hours: totalHours,
        total_cost: totalCost,
        total_savings: totalSavings,
        agency_dependency_ratio: agencyDependencyRatio,
        overtime_hours: overtimeHours,
        computed_at: computedAt,
      },
      { onConflict: 'facility_id,period_start,period_end' }
    )

  return snapshot
}

// ─── Period Helpers ───────────────────────────────────────────────────────────

export type KPIPeriod = '30d' | '90d' | 'ytd'

export function periodToDates(period: KPIPeriod): { start: Date; end: Date } {
  const end = new Date()
  let start: Date

  if (period === '30d') {
    start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000)
  } else if (period === '90d') {
    start = new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000)
  } else {
    // YTD: Jan 1 of current year
    start = new Date(end.getFullYear(), 0, 1)
  }

  return { start, end }
}

export function previousPeriodDates(start: Date, end: Date): { start: Date; end: Date } {
  const duration = end.getTime() - start.getTime()
  return {
    start: new Date(start.getTime() - duration),
    end: new Date(start.getTime()),
  }
}

// ─── Fetch KPI Snapshot ───────────────────────────────────────────────────────

export async function fetchKPISnapshot(
  facilityId: string,
  start: Date,
  end: Date
): Promise<KPISnapshot | null> {
  const supabase = createSupabaseAdminClient()
  const periodStart = start.toISOString().slice(0, 10)
  const periodEnd = end.toISOString().slice(0, 10)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('kpi_snapshots')
    .select('facility_id, period_start, period_end, total_hours, total_cost, total_savings, agency_dependency_ratio, overtime_hours, computed_at')
    .eq('facility_id', facilityId)
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .single()

  if (!data) return null
  const row = data as KPISnapshotRow
  return {
    facility_id: row.facility_id,
    period_start: row.period_start,
    period_end: row.period_end,
    total_hours: Number(row.total_hours),
    total_cost: Number(row.total_cost),
    total_savings: Number(row.total_savings),
    agency_dependency_ratio: Number(row.agency_dependency_ratio),
    overtime_hours: Number(row.overtime_hours),
    computed_at: row.computed_at,
  }
}
