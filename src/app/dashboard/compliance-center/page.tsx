/**
 * Compliance Center Dashboard
 * NurseSphere TIER 1 — Continuous Compliance Engine
 *
 * Server component with client sub-components.
 * Role-guarded: hospital_admin + super_admin only.
 *
 * Displays:
 *   - Last sweep timestamp + status badge
 *   - % nurses compliant (score >= 80)
 *   - Active alerts by severity
 *   - Nurses auto-suspended in last 30 days
 *   - Feature flag gate: continuous_compliance
 *   - Export CSV button
 *
 * PHI: No patient data or nurse names displayed beyond display_name if present.
 */

import { redirect } from 'next/navigation'
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase-server'
import { featureFlags } from '@/lib/feature-flags'
import { ComplianceCenterClient } from './ComplianceCenterClient'

// ── Types ──────────────────────────────────────────────────────────────────────

interface SuspendedNurse {
  nurseId: string
  suspendedAt: string
  reason: string | null
}

interface SweepLogRow {
  id: string
  started_at: string
  completed_at: string | null
  nurses_checked: number
  alerts_created: number
  suspensions_triggered: number
  error_count: number
  status: string
}

interface AlertCountRow {
  severity: string
  count: number
}

export interface ComplianceCenterData {
  lastSweep: SweepLogRow | null
  totalNurses: number
  compliantNurses: number
  alertsBySeverity: AlertCountRow[]
  suspendedLast30Days: SuspendedNurse[]
  featureEnabled: boolean
}

// ── Server Component ──────────────────────────────────────────────────────────

export default async function ComplianceCenterPage() {
  // Feature flag check
  if (!featureFlags.continuous_compliance) {
    // Feature disabled — show placeholder or redirect
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-white text-xl font-semibold">Compliance Center</h2>
          <p className="text-gray-400 mt-2">
            The Continuous Compliance Engine is not yet enabled.
            Set <code className="text-yellow-400">FEATURE_CONTINUOUS_COMPLIANCE=true</code> to activate.
          </p>
        </div>
      </div>
    )
  }

  // Auth check
  const supabase = await createSupabaseServerClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    redirect('/auth/signin')
  }

  const adminClient = createSupabaseAdminClient()

  // Role guard
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role, facility_id')
    .eq('id', session.user.id)
    .maybeSingle()

  if (!profile || !['hospital_admin', 'super_admin'].includes(profile.role ?? '')) {
    redirect('/dashboard')
  }

  const facilityId = profile.facility_id as string | null

  // ── Data fetching ───────────────────────────────────────────────────────────

  // Last sweep
  const { data: sweepRows } = await adminClient
    .from('compliance_sweep_log')
    .select('id, started_at, completed_at, nurses_checked, alerts_created, suspensions_triggered, error_count, status')
    .order('created_at', { ascending: false })
    .limit(1)
  const lastSweep = (sweepRows?.[0] as SweepLogRow) ?? null

  // Nurse counts (scoped to facility for hospital_admin)
  const nursesQuery = adminClient
    .from('profiles')
    .select('id, status', { count: 'exact', head: false })
    .eq('role', 'nurse')

  const scopedNursesQuery = profile.role === 'super_admin'
    ? nursesQuery
    : nursesQuery.eq('facility_id', facilityId)

  const { data: allNurses, count: totalCount } = await scopedNursesQuery
  const totalNurses = totalCount ?? 0

  // Compliance scores
  const nurseIds = (allNurses ?? []).map((n: { id: string }) => n.id)

  let compliantNurses = 0
  if (nurseIds.length > 0) {
    const { data: scores } = await adminClient
      .from('compliance_scores')
      .select('nurse_id, score')
      .in('nurse_id', nurseIds)
      .gte('score', 80)
    compliantNurses = (scores ?? []).length
  }

  // Active alerts by severity
  const alertsQuery = adminClient
    .from('compliance_alerts')
    .select('severity')
    .eq('status', 'open')

  const scopedAlertsQuery = profile.role === 'super_admin'
    ? alertsQuery
    : alertsQuery.eq('facility_id', facilityId)

  const { data: alertRows } = await scopedAlertsQuery

  const alertsBySeverityMap = new Map<string, number>()
  for (const row of (alertRows ?? [])) {
    alertsBySeverityMap.set(row.severity, (alertsBySeverityMap.get(row.severity) ?? 0) + 1)
  }
  const alertsBySeverity: AlertCountRow[] = Array.from(alertsBySeverityMap.entries()).map(([severity, count]) => ({
    severity,
    count,
  }))

  // Nurses suspended in last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const suspendedQuery = adminClient
    .from('profiles')
    .select('id, suspended_at, suspension_reason')
    .eq('status', 'suspended')
    .gte('suspended_at', thirtyDaysAgo)

  const scopedSuspendedQuery = profile.role === 'super_admin'
    ? suspendedQuery
    : suspendedQuery.eq('facility_id', facilityId)

  const { data: suspendedRows } = await scopedSuspendedQuery

  const suspendedLast30Days: SuspendedNurse[] = (suspendedRows ?? []).map((row: {
    id: string
    suspended_at: string | null
    suspension_reason: string | null
  }) => ({
    nurseId: row.id,
    suspendedAt: row.suspended_at ?? '',
    reason: row.suspension_reason,
  }))

  const data: ComplianceCenterData = {
    lastSweep,
    totalNurses,
    compliantNurses,
    alertsBySeverity,
    suspendedLast30Days,
    featureEnabled: true,
  }

  return <ComplianceCenterClient data={data} />
}
