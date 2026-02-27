/**
 * GET /api/timecards
 *
 * List timecards for:
 *   - Facility admin: sees all timecards for their facility
 *   - Nurse: sees only their own timecards
 *
 * Query params:
 *   ?status=   — filter by status (draft|submitted|approved|disputed|paid)
 *   ?shift_id= — filter by shift
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedUser } from '@/lib/supabase-server'

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const user = await getAuthenticatedUser(supabase)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const shiftId = searchParams.get('shift_id')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = (supabase as any)
      .from('timecards')
      .select(`
        id,
        shift_id,
        nurse_id,
        facility_id,
        clock_in_at,
        clock_out_at,
        break_minutes,
        total_hours,
        status,
        submitted_at,
        approved_at,
        approved_by,
        dispute_reason,
        notes,
        created_at,
        updated_at,
        shifts:shift_id (
          start_time,
          end_time,
          department,
          hourly_rate
        ),
        nurse:nurse_id (
          full_name
        )
      `)
      .order('created_at', { ascending: false })

    if (user.role === 'nurse') {
      // Nurses see only their own timecards (enforced by RLS + explicit filter)
      query = query.eq('nurse_id', user.userId)
    } else if (user.role === 'admin') {
      // Admins see facility timecards — RLS enforces facility scope
      const { data: fa } = await (supabase as any)
        .from('facility_admins')
        .select('facility_id')
        .eq('profile_id', user.userId)
        .limit(1)
        .single()

      if (!fa?.facility_id) {
        return NextResponse.json({ error: 'No facility found for admin' }, { status: 403 })
      }
      query = query.eq('facility_id', fa.facility_id)
    } else {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (status) query = query.eq('status', status)
    if (shiftId) query = query.eq('shift_id', shiftId)

    const { data, error } = await query

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json({ timecards: [] })
      }
      throw error
    }

    return NextResponse.json({ timecards: data ?? [] })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Timecards GET] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
