/**
 * POST /api/timecards/[id]/clock-out
 *
 * Nurse clocks out: sets clock_out_at = now(), break_minutes, status → 'submitted'.
 * Body: { break_minutes: number }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedUser } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params
    const supabase = await createSupabaseServerClient()
    const user = await getAuthenticatedUser(supabase)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (user.role !== 'nurse') {
      return NextResponse.json({ error: 'Only nurses can clock out' }, { status: 403 })
    }

    let body: { break_minutes?: number } = {}
    try { body = await request.json() } catch { /* empty body ok */ }

    const breakMinutes = typeof body.break_minutes === 'number'
      ? Math.max(0, Math.round(body.break_minutes))
      : 0

    // Fetch existing timecard
    const { data: existing, error: fetchError } = await (supabase as any)
      .from('timecards')
      .select('id, nurse_id, facility_id, shift_id, clock_in_at, status')
      .eq('id', id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Timecard not found' }, { status: 404 })
    }

    if (existing.nurse_id !== user.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!existing.clock_in_at) {
      return NextResponse.json({ error: 'Cannot clock out before clocking in' }, { status: 422 })
    }

    const now = new Date().toISOString()

    const { data: timecard, error: updateError } = await (supabase as any)
      .from('timecards')
      .update({
        clock_out_at: now,
        break_minutes: breakMinutes,
        status: 'submitted',
        submitted_at: now,
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError) throw updateError

    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: user.userId,
      action: 'timecard.clock_out',
      target_type: 'timecard',
      target_id: id,
      facility_id: existing.facility_id,
      metadata: {
        shift_id: existing.shift_id,
        clock_out_at: now,
        break_minutes: breakMinutes,
        status: 'submitted',
      },
      ip_address,
    })

    return NextResponse.json({ timecard })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Timecards ClockOut] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
