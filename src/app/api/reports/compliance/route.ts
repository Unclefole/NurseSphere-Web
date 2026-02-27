/**
 * GET /api/reports/compliance
 * Exports a current compliance snapshot as CSV.
 * Admin only (hospital_admin). Facility-scoped. HIPAA audit-logged.
 * No date range needed — returns current state of all credentials.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { generateComplianceReport, auditLogExport } from '@/lib/reports/report-generator'

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const csv = await generateComplianceReport(auth.hospitalId)

    auditLogExport(auth.userId, auth.hospitalId, 'compliance')

    const today = new Date().toISOString().split('T')[0]
    const filename = `nursesphere-compliance-snapshot-${today}.csv`

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, no-cache',
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[ReportsCompliance] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
