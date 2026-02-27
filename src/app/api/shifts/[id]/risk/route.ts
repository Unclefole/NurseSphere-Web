/**
 * GET  /api/shifts/[id]/risk  — returns shift_risk + top candidates
 * POST /api/shifts/[id]/risk  — triggers risk recompute (admin only)
 *
 * HIPAA: No PHI in responses. facility_id scoped. All writes audit logged.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'
import { recomputeShiftRisk } from '@/lib/shifts/escalation-job'

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: shiftId } = await params
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch shift_risk (scoped to this facility via RLS)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: risk, error: riskError } = await (supabase as any)
      .from('shift_risk')
      .select('shift_id, facility_id, fill_probability, risk_level, recommended_rate_delta, recommended_actions, computed_at')
      .eq('shift_id', shiftId)
      .eq('facility_id', auth.hospitalId)
      .single()

    if (riskError && riskError.code !== 'PGRST116') {
      // PGRST116 = not found — acceptable
      if (riskError.code === '42P01') {
        return NextResponse.json({ risk: null, candidates: [], message: 'shift_risk table not yet provisioned' })
      }
      throw riskError
    }

    // Fetch top candidates
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: candidates, error: candidatesError } = await (supabase as any)
      .from('shift_candidates')
      .select('nurse_id, score_accept, score_fit, rank, reasons')
      .eq('shift_id', shiftId)
      .eq('facility_id', auth.hospitalId)
      .order('rank', { ascending: true })
      .limit(20)

    if (candidatesError && candidatesError.code !== '42P01') {
      throw candidatesError
    }

    // Enrich candidates with nurse names (no other PHI)
    const candidateList = (candidates ?? []) as Array<{
      nurse_id: string
      score_accept: number
      score_fit: number
      rank: number
      reasons: Record<string, unknown>
    }>

    const nurseIds = candidateList.map(c => c.nurse_id)
    let nurseNames: Record<string, string> = {}

    if (nurseIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: profiles } = await (supabase as any)
        .from('profiles')
        .select('id, full_name')
        .in('id', nurseIds)

      if (profiles) {
        nurseNames = Object.fromEntries(
          (profiles as Array<{ id: string; full_name: string | null }>).map(p => [p.id, p.full_name ?? 'Unknown'])
        )
      }
    }

    const enrichedCandidates = candidateList.map(c => ({
      ...c,
      nurse_name: nurseNames[c.nurse_id] ?? 'Unknown',
    }))

    return NextResponse.json({
      risk: risk ?? null,
      candidates: enrichedCandidates,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[ShiftRisk GET] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: shiftId } = await params
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify shift belongs to this facility
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shift, error: shiftError } = await (supabase as any)
      .from('shifts')
      .select('id, facility_id')
      .eq('id', shiftId)
      .eq('facility_id', auth.hospitalId)
      .single()

    if (shiftError || !shift) {
      return NextResponse.json({ error: 'Shift not found' }, { status: 404 })
    }

    // Trigger recompute
    await recomputeShiftRisk(shiftId)

    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: auth.userId,
      action: 'shift.risk.recomputed',
      target_type: 'shift',
      target_id: shiftId,
      facility_id: auth.hospitalId,
      metadata: { triggered_by: 'admin_manual' },
      ip_address,
    })

    return NextResponse.json({ success: true, message: 'Risk recomputed' })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[ShiftRisk POST] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
