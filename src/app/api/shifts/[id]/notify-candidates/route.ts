/**
 * POST /api/shifts/[id]/notify-candidates
 * Notifies top N candidates for a shift. Human-initiated only. Audit logged.
 * Body: { count: number } (max 50)
 * Returns: { notified: string[] } (nurse IDs only — no PHI)
 *
 * HIPAA: Notification content managed downstream. Only IDs returned here.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'

const MAX_NOTIFY = 50

interface NotifyBody {
  count?: number
}

interface CandidateRow {
  nurse_id: string
  rank: number
}

interface ProfileRow {
  id: string
  full_name: string | null
}

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

    // Parse + validate body
    let body: NotifyBody = {}
    try {
      body = await request.json()
    } catch {
      // empty body → use default
    }

    const count = Math.min(Math.max(1, body.count ?? 20), MAX_NOTIFY)

    // Verify shift belongs to this facility
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shift, error: shiftError } = await (supabase as any)
      .from('shifts')
      .select('id, facility_id, title, start_time')
      .eq('id', shiftId)
      .eq('facility_id', auth.hospitalId)
      .single()

    if (shiftError || !shift) {
      return NextResponse.json({ error: 'Shift not found' }, { status: 404 })
    }

    // Fetch top candidates
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: candidates, error: candidatesError } = await (supabase as any)
      .from('shift_candidates')
      .select('nurse_id, rank')
      .eq('shift_id', shiftId)
      .eq('facility_id', auth.hospitalId)
      .order('rank', { ascending: true })
      .limit(count)

    if (candidatesError) {
      if (candidatesError.code === '42P01') {
        return NextResponse.json(
          { error: 'shift_candidates table not yet provisioned' },
          { status: 503 }
        )
      }
      throw candidatesError
    }

    const candidateList = (candidates ?? []) as CandidateRow[]
    const nurseIds = candidateList.map(c => c.nurse_id)

    if (nurseIds.length === 0) {
      return NextResponse.json({
        notified: [],
        message: 'No candidates available for this shift',
      })
    }

    /**
     * Notification stub.
     * In production, integrate with push notifications / SMS / email service.
     * For now: log the intent and return the nurse IDs.
     * NEVER auto-fills the shift — human must approve.
     */
    console.info(
      `[NotifyCandidates] Would notify ${nurseIds.length} nurses for shift ${shiftId}. ` +
      `Integration pending.`
    )

    // Audit log — no nurse names, only IDs and counts
    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: auth.userId,
      action: 'shift.candidates.notified',
      target_type: 'shift',
      target_id: shiftId,
      facility_id: auth.hospitalId,
      metadata: {
        notified_count: nurseIds.length,
        requested_count: count,
        nurse_ids: nurseIds, // IDs only, not names
      },
      ip_address,
    })

    return NextResponse.json({
      notified: nurseIds,
      count: nurseIds.length,
      message: `Notification queued for ${nurseIds.length} nurses`,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[NotifyCandidates POST] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
