/**
 * Compliance Export CSV API
 * GET /api/compliance/export-csv
 *
 * Returns CSV with columns (NO PHI):
 *   nurse_id (UUID), compliance_score, status, last_checked, alert_count, suspension_date
 *
 * Auth: hospital_admin or super_admin only.
 * Audit logs the export action.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase-server'
import { writeAuditLog } from '@/lib/audit'

export async function GET(req: NextRequest) {
  try {
    // Auth check
    const supabase = await createSupabaseServerClient()
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createSupabaseAdminClient()

    // Role guard
    const { data: profile } = await adminClient
      .from('profiles')
      .select('role, facility_id')
      .eq('id', session.user.id)
      .maybeSingle()

    if (!profile || !['hospital_admin', 'super_admin'].includes(profile.role ?? '')) {
      return NextResponse.json({ error: 'Forbidden — admin role required' }, { status: 403 })
    }

    const facilityId = profile.facility_id as string | null

    // Fetch compliance data (no PHI — UUIDs only)
    // Query 1: nurse profiles + status
    const profileQuery = adminClient
      .from('profiles')
      .select('id, status, suspended_at')
      .eq('role', 'nurse')

    // Scope to facility if not super_admin
    const profileResult = profile.role === 'super_admin'
      ? await profileQuery
      : await profileQuery.eq('facility_id', facilityId)

    const nurses = profileResult.data ?? []
    const nurseIds = nurses.map((n: { id: string }) => n.id)

    if (nurseIds.length === 0) {
      return new NextResponse('nurse_id,compliance_score,status,last_checked,alert_count,suspension_date\n', {
        headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="compliance-export.csv"' },
      })
    }

    // Query 2: latest compliance scores per nurse
    const { data: scores } = await adminClient
      .from('compliance_scores')
      .select('nurse_id, score, computed_at')
      .in('nurse_id', nurseIds)
      .order('computed_at', { ascending: false })

    // Query 3: alert counts per nurse
    const { data: alerts } = await adminClient
      .from('compliance_alerts')
      .select('nurse_id')
      .in('nurse_id', nurseIds)
      .eq('status', 'open')

    // Build lookup maps
    const scoreMap = new Map<string, { score: number; computed_at: string }>()
    for (const s of (scores ?? [])) {
      if (!scoreMap.has(s.nurse_id)) {
        scoreMap.set(s.nurse_id, { score: s.score, computed_at: s.computed_at })
      }
    }

    const alertCountMap = new Map<string, number>()
    for (const a of (alerts ?? [])) {
      alertCountMap.set(a.nurse_id, (alertCountMap.get(a.nurse_id) ?? 0) + 1)
    }

    // Build CSV rows — no PHI
    const csvRows: string[] = [
      'nurse_id,compliance_score,status,last_checked,alert_count,suspension_date',
    ]

    for (const nurse of nurses) {
      const scoreRow = scoreMap.get(nurse.id)
      const row = [
        nurse.id,                                         // UUID only — no name
        scoreRow?.score ?? '',
        nurse.status ?? 'active',
        scoreRow?.computed_at ?? '',
        alertCountMap.get(nurse.id) ?? 0,
        nurse.suspended_at ?? '',
      ].join(',')
      csvRows.push(row)
    }

    const csv = csvRows.join('\n') + '\n'

    // Audit log the export
    await writeAuditLog({
      actor_id: session.user.id,
      facility_id: facilityId,
      action: 'compliance.csv_exported',
      target_type: 'compliance_report',
      metadata: {
        nurse_count: nurses.length,
        exported_by_role: profile.role,
      },
    })

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="nursesphere-compliance-export.csv"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[API/export-csv] Error:', err)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}
