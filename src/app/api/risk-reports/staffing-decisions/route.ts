/**
 * GET /api/risk-reports/staffing-decisions
 *
 * Returns staffing decision log (shift_risk_certificates) for the facility.
 * Role-guarded: hospital_admin + super_admin only.
 * Query params: startDate, endDate (ISO date strings)
 * Audit logged.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'
import { featureFlags } from '@/lib/feature-flags'

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    if (!featureFlags.litigation_defense_export) {
      return NextResponse.json({ error: 'Feature not available' }, { status: 403 })
    }

    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = (supabase as any)
      .from('shift_risk_certificates')
      .select('id, shift_id, nurse_id, compliance_score, competency_score, admin_override, certificate_hash, issued_at, created_at')
      .eq('facility_id', auth.hospitalId)
      .order('issued_at', { ascending: false })
      .limit(500)

    if (startDate) {
      query = query.gte('issued_at', new Date(startDate).toISOString())
    }
    if (endDate) {
      // End of the given day
      const end = new Date(endDate)
      end.setHours(23, 59, 59, 999)
      query = query.lte('issued_at', end.toISOString())
    }

    const { data, error } = await query

    if (error) {
      console.error('[RiskReports] staffing-decisions error:', error.message)
      return NextResponse.json({ error: 'Failed to fetch staffing decisions' }, { status: 500 })
    }

    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: auth.userId,
      action: 'litigation_export.staffing_decisions_viewed',
      target_type: 'risk_report',
      facility_id: auth.hospitalId,
      metadata: { start_date: startDate, end_date: endDate, record_count: data?.length ?? 0 },
      ip_address,
    })

    return NextResponse.json({ decisions: data ?? [], total: data?.length ?? 0 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[RiskReports] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
