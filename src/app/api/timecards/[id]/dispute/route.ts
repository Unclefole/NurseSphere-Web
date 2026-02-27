/**
 * POST /api/timecards/[id]/dispute
 *
 * Mark a timecard as disputed.
 * Body: { reason: string }
 * Accessible by: admin (facility access) or nurse (own timecard)
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

    let body: { reason?: string } = {}
    try { body = await request.json() } catch { /* empty body */ }

    const reason = body.reason?.trim()
    if (!reason) {
      return NextResponse.json({ error: 'dispute reason is required' }, { status: 400 })
    }

    // Fetch the timecard
    const { data: timecard, error: fetchError } = await (supabase as any)
      .from('timecards')
      .select('id, nurse_id, facility_id, shift_id, status')
      .eq('id', id)
      .single()

    if (fetchError || !timecard) {
      return NextResponse.json({ error: 'Timecard not found' }, { status: 404 })
    }

    // Authorization: nurse can only dispute their own; admin must be at same facility
    if (user.role === 'nurse' && timecard.nurse_id !== user.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (user.role === 'admin') {
      const { data: fa } = await (supabase as any)
        .from('facility_admins')
        .select('facility_id')
        .eq('profile_id', user.userId)
        .eq('facility_id', timecard.facility_id)
        .single()

      if (!fa) {
        return NextResponse.json({ error: 'Forbidden — different facility' }, { status: 403 })
      }
    }

    if (timecard.status === 'paid') {
      return NextResponse.json({ error: 'Cannot dispute a paid timecard' }, { status: 422 })
    }

    const { data: updated, error: updateError } = await (supabase as any)
      .from('timecards')
      .update({
        status: 'disputed',
        dispute_reason: reason,
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError) throw updateError

    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: user.userId,
      action: 'timecard.disputed',
      target_type: 'timecard',
      target_id: id,
      facility_id: timecard.facility_id,
      metadata: {
        shift_id: timecard.shift_id,
        disputed_by_role: user.role,
        // HIPAA: no reason text logged (may contain PHI)
      },
      ip_address,
    })

    return NextResponse.json({ timecard: updated })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Timecards Dispute] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
