/**
 * NurseSphere Report Generator — TASK 10
 * Generates structured CSV reports for shift, payroll, compliance, and savings.
 * HIPAA: Facility-scoped. All exports audit-logged. No PHI beyond minimum necessary.
 * Server-only — do NOT import in client components.
 */

import { createClient } from '@supabase/supabase-js'
import { writeAuditLog } from '@/lib/audit'

// ─── Types ────────────────────────────────────────────────────────────────────

export type CsvData = string

// ─── Supabase Admin Client ─────────────────────────────────────────────────────

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service env vars for report generation')
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ─── CSV Utilities ────────────────────────────────────────────────────────────

/**
 * Escape a single CSV cell value.
 * Wraps in quotes if the value contains commas, quotes, or newlines.
 */
function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * Build a CSV string from an array of headers and rows.
 * Handles empty datasets (returns headers only).
 * Escapes commas and quotes in all values.
 */
export function csvFromArray(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const headerLine = headers.map(escapeCsvCell).join(',')
  if (rows.length === 0) return headerLine
  const dataLines = rows.map((row) => row.map(escapeCsvCell).join(','))
  return [headerLine, ...dataLines].join('\n')
}

// ─── Audit Logging ────────────────────────────────────────────────────────────

/**
 * Audit-log every report export for HIPAA compliance.
 * Fire-and-forget — errors are swallowed to avoid blocking the response.
 */
export function auditLogExport(userId: string, facilityId: string, reportType: string): void {
  writeAuditLog({
    actor_id: userId,
    facility_id: facilityId,
    action: `report.exported.${reportType}`,
    target_type: 'report',
    target_id: null,
    metadata: { report_type: reportType, exported_at: new Date().toISOString() },
  }).catch((err) => {
    console.error('[ReportGenerator] auditLogExport failed:', err)
  })
}

// ─── Shift Report ─────────────────────────────────────────────────────────────

interface ShiftRow {
  id: string
  start_time: string
  unit: string | null
  role: string | null
  status: string | null
  hourly_rate: number | null
  profiles: { full_name: string | null } | null
  timecards: { total_hours: number | null }[] | null
}

/**
 * generateShiftReport
 * Columns: shift_id, date, unit, role, nurse_name, status, hours, rate, total_cost
 */
export async function generateShiftReport(
  facilityId: string,
  startDate: string,
  endDate: string,
): Promise<CsvData> {
  const supabase = createAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('shifts')
    .select(`
      id,
      start_time,
      unit,
      role,
      status,
      hourly_rate,
      profiles:nurse_id ( full_name ),
      timecards ( total_hours )
    `)
    .eq('facility_id', facilityId)
    .gte('start_time', `${startDate}T00:00:00.000Z`)
    .lte('start_time', `${endDate}T23:59:59.999Z`)
    .order('start_time', { ascending: true })
    .limit(10000)

  if (error) {
    console.error('[ShiftReport] Query failed:', error.message)
    throw new Error(`Shift report query failed: ${error.message}`)
  }

  const rows = ((data ?? []) as ShiftRow[]).map((shift) => {
    const hours = shift.timecards?.[0]?.total_hours ?? null
    const rate = shift.hourly_rate ?? 0
    const totalCost = hours !== null ? Math.round(hours * rate * 100) / 100 : null
    const nurseName = shift.profiles?.full_name ?? 'Unassigned'
    const date = shift.start_time ? shift.start_time.split('T')[0] : ''

    return [
      shift.id,
      date,
      shift.unit ?? '',
      shift.role ?? '',
      nurseName,
      shift.status ?? '',
      hours,
      rate,
      totalCost,
    ]
  })

  return csvFromArray(
    ['shift_id', 'date', 'unit', 'role', 'nurse_name', 'status', 'hours', 'rate', 'total_cost'],
    rows,
  )
}

// ─── Payroll Report ───────────────────────────────────────────────────────────

interface TimecardRow {
  id: string
  clock_in: string | null
  clock_out: string | null
  total_hours: number | null
  payout_status: string | null
  shifts: {
    start_time: string | null
    hourly_rate: number | null
    profiles: { full_name: string | null } | null
  } | null
}

/** Platform fee percentage (10%) */
const PLATFORM_FEE_PCT = 0.10

/**
 * generatePayrollReport
 * Columns: nurse_name, shift_date, hours_worked, rate, gross_pay, platform_fee, net_pay, payout_status
 */
export async function generatePayrollReport(
  facilityId: string,
  startDate: string,
  endDate: string,
): Promise<CsvData> {
  const supabase = createAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('timecards')
    .select(`
      id,
      clock_in,
      clock_out,
      total_hours,
      payout_status,
      shifts:shift_id (
        start_time,
        hourly_rate,
        profiles:nurse_id ( full_name )
      )
    `)
    .eq('status', 'approved')
    .eq('facility_id', facilityId)
    .gte('clock_in', `${startDate}T00:00:00.000Z`)
    .lte('clock_in', `${endDate}T23:59:59.999Z`)
    .order('clock_in', { ascending: true })
    .limit(10000)

  if (error) {
    console.error('[PayrollReport] Query failed:', error.message)
    throw new Error(`Payroll report query failed: ${error.message}`)
  }

  const rows = ((data ?? []) as TimecardRow[]).map((tc) => {
    const nurseName = tc.shifts?.profiles?.full_name ?? 'Unknown'
    const shiftDate = tc.shifts?.start_time?.split('T')[0] ?? ''
    const hours = tc.total_hours ?? 0
    const rate = tc.shifts?.hourly_rate ?? 0
    const grossPay = Math.round(hours * rate * 100) / 100
    const platformFee = Math.round(grossPay * PLATFORM_FEE_PCT * 100) / 100
    const netPay = Math.round((grossPay - platformFee) * 100) / 100

    return [
      nurseName,
      shiftDate,
      hours,
      rate,
      grossPay,
      platformFee,
      netPay,
      tc.payout_status ?? 'pending',
    ]
  })

  return csvFromArray(
    ['nurse_name', 'shift_date', 'hours_worked', 'rate', 'gross_pay', 'platform_fee', 'net_pay', 'payout_status'],
    rows,
  )
}

// ─── Compliance Report ────────────────────────────────────────────────────────

interface CredentialRow {
  credential_type: string | null
  status: string | null
  expiration_date: string | null
  profiles: { full_name: string | null } | null
  compliance_scores: { score: number | null }[] | null
}

/**
 * generateComplianceReport
 * Columns: nurse_name, credential_type, status, expiration_date, days_until_expiry, compliance_score
 */
export async function generateComplianceReport(facilityId: string): Promise<CsvData> {
  const supabase = createAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('credentials')
    .select(`
      credential_type,
      status,
      expiration_date,
      profiles:nurse_id ( full_name ),
      compliance_scores ( score )
    `)
    .eq('facility_id', facilityId)
    .order('expiration_date', { ascending: true })
    .limit(10000)

  if (error) {
    console.error('[ComplianceReport] Query failed:', error.message)
    throw new Error(`Compliance report query failed: ${error.message}`)
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const rows = ((data ?? []) as CredentialRow[]).map((cred) => {
    const nurseName = cred.profiles?.full_name ?? 'Unknown'
    const complianceScore = cred.compliance_scores?.[0]?.score ?? null

    let daysUntilExpiry: number | null = null
    if (cred.expiration_date) {
      const expDate = new Date(cred.expiration_date)
      expDate.setHours(0, 0, 0, 0)
      daysUntilExpiry = Math.round((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    }

    return [
      nurseName,
      cred.credential_type ?? '',
      cred.status ?? '',
      cred.expiration_date ?? '',
      daysUntilExpiry,
      complianceScore,
    ]
  })

  return csvFromArray(
    ['nurse_name', 'credential_type', 'status', 'expiration_date', 'days_until_expiry', 'compliance_score'],
    rows,
  )
}

// ─── Agency Savings Report ────────────────────────────────────────────────────

interface CostEventRow {
  cost: number | null
  baseline_cost: number | null
  savings: number | null
  hours: number | null
  event_type: string | null
  occurred_at: string | null
}

/**
 * generateAgencySavingsReport
 * Columns: period, total_shifts, total_hours, nursesphere_cost, agency_baseline_cost, savings, savings_pct
 */
export async function generateAgencySavingsReport(
  facilityId: string,
  startDate: string,
  endDate: string,
): Promise<CsvData> {
  const supabase = createAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('cost_events')
    .select('cost, baseline_cost, savings, hours, event_type, occurred_at')
    .eq('facility_id', facilityId)
    .gte('occurred_at', `${startDate}T00:00:00.000Z`)
    .lte('occurred_at', `${endDate}T23:59:59.999Z`)
    .order('occurred_at', { ascending: true })
    .limit(10000)

  if (error) {
    console.error('[SavingsReport] Query failed:', error.message)
    throw new Error(`Agency savings report query failed: ${error.message}`)
  }

  // Aggregate by month (period = YYYY-MM)
  const periodMap = new Map<
    string,
    { totalShifts: number; totalHours: number; nursesphereCost: number; agencyBaselineCost: number; savings: number }
  >()

  for (const row of (data ?? []) as CostEventRow[]) {
    const period = row.occurred_at ? row.occurred_at.slice(0, 7) : 'unknown'
    const existing = periodMap.get(period) ?? {
      totalShifts: 0,
      totalHours: 0,
      nursesphereCost: 0,
      agencyBaselineCost: 0,
      savings: 0,
    }

    existing.totalShifts += 1
    existing.totalHours += row.hours ?? 0
    existing.nursesphereCost += row.cost ?? 0
    existing.agencyBaselineCost += row.baseline_cost ?? 0
    existing.savings += row.savings ?? 0

    periodMap.set(period, existing)
  }

  const rows = Array.from(periodMap.entries()).map(([period, agg]) => {
    const savingsPct =
      agg.agencyBaselineCost > 0
        ? Math.round((agg.savings / agg.agencyBaselineCost) * 10000) / 100
        : 0

    return [
      period,
      agg.totalShifts,
      Math.round(agg.totalHours * 100) / 100,
      Math.round(agg.nursesphereCost * 100) / 100,
      Math.round(agg.agencyBaselineCost * 100) / 100,
      Math.round(agg.savings * 100) / 100,
      savingsPct,
    ]
  })

  return csvFromArray(
    ['period', 'total_shifts', 'total_hours', 'nursesphere_cost', 'agency_baseline_cost', 'savings', 'savings_pct'],
    rows,
  )
}
