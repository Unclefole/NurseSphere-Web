/**
 * GET /api/finance/kpis?period=30d|90d|ytd
 * Returns current KPI snapshot + trend vs previous period.
 * Admin only — scoped to facility.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import {
  aggregateKPIs,
  fetchKPISnapshot,
  periodToDates,
  previousPeriodDates,
  type KPIPeriod,
} from '@/lib/finance/cost-calculator'

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const rawPeriod = searchParams.get('period') ?? '30d'
    const period: KPIPeriod = ['30d', '90d', 'ytd'].includes(rawPeriod)
      ? (rawPeriod as KPIPeriod)
      : '30d'

    const { start, end } = periodToDates(period)
    const prev = previousPeriodDates(start, end)

    // Aggregate current period (also upserts to DB)
    let current = null
    let previous = null

    try {
      current = await aggregateKPIs(auth.hospitalId, start, end)
    } catch {
      // Table may not be provisioned yet — try fetching cached snapshot
      current = await fetchKPISnapshot(auth.hospitalId, start, end)
    }

    try {
      previous = await fetchKPISnapshot(auth.hospitalId, prev.start, prev.end)
    } catch {
      previous = null
    }

    const savingsDelta = current && previous
      ? current.total_savings - previous.total_savings
      : 0

    const agencyRatioDelta = current && previous
      ? current.agency_dependency_ratio - previous.agency_dependency_ratio
      : 0

    const costPerHour = current && current.total_hours > 0
      ? current.total_cost / current.total_hours
      : 0

    return NextResponse.json({
      period,
      current,
      previous,
      trend: {
        savings_delta: savingsDelta,
        agency_ratio_delta: agencyRatioDelta,
      },
      cost_per_hour: costPerHour,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[FinanceKPIs GET] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
