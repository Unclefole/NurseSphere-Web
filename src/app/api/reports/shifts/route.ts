/**
 * GET /api/reports/shifts
 * Exports shift report as CSV for a given date range.
 * Admin only (hospital_admin). Facility-scoped. HIPAA audit-logged.
 *
 * Query params:
 *   start — YYYY-MM-DD (required)
 *   end   — YYYY-MM-DD (required)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { generateShiftReport, auditLogExport } from '@/lib/reports/report-generator'

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const start = searchParams.get('start')
    const end = searchParams.get('end')

    if (!start || !end) {
      return NextResponse.json({ error: 'start and end query params are required (YYYY-MM-DD)' }, { status: 400 })
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return NextResponse.json({ error: 'Invalid date format. Use YYYY-MM-DD.' }, { status: 400 })
    }

    const csv = await generateShiftReport(auth.hospitalId, start, end)

    auditLogExport(auth.userId, auth.hospitalId, 'shifts')

    const filename = `nursesphere-shifts-${start}-to-${end}.csv`

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
    console.error('[ReportsShifts] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
