/**
 * POST /api/timecards/[id]/clock-in
 *
 * Nurse clocks in: creates or updates timecard with clock_in_at = now().
 * Validates nurse is assigned to the shift.
 * [id] = timecard UUID (or 'new' if creating fresh — client should pass shift_id in body).
 *
 * Body (for new timecards — id='new'): { shift_id: string }
 * Body (for existing timecard): no body needed
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
      return NextResponse.json({ error: 'Only nurses can clock in' }, { status: 403 })
    }

    const { ip_address } = extractRequestMeta(request)
    const now = new Date().toISOString()

    if (id === 'new') {
      // Creating a new timecard for a shift
      let body: { shift_id?: string } = {}
      try { body = await request.json() } catch { /* empty body ok */ }

      const { shift_id } = body
      if (!shift_id) {
        return NextResponse.json({ error: 'shift_id is required when creating a new timecard' }, { status: 400 })
      }

      // Validate nurse is assigned to this shift
      const { data: shift, error: shiftError } = await (supabase as any)
        .from('shifts')
        .select('id, facility_id, nurse_id, status')
        .eq('id', shift_id)
        .single()

      if (shiftError || !shift) {
        return NextResponse.json({ error: 'Shift not found' }, { status: 404 })
      }

      // Verify the nurse is assigned (nurse_id on shift or in shift_applications)
      if (shift.nurse_id !== user.userId) {
        // Check shift_applications as fallback
        const { data: application } = await (supabase as any)
          .from('shift_applications')
          .select('id')
          .eq('shift_id', shift_id)
          .eq('nurse_id', user.userId)
          .eq('status', 'approved')
          .single()

        if (!application) {
          return NextResponse.json({ error: 'You are not assigned to this shift' }, { status: 403 })
        }
      }

      // Create timecard
      const { data: timecard, error: insertError } = await (supabase as any)
        .from('timecards')
        .insert({
          shift_id,
          nurse_id: user.userId,
          facility_id: shift.facility_id,
          clock_in_at: now,
          status: 'draft',
        })
        .select()
        .single()

      if (insertError) {
        if (insertError.code === '23505') {
          // Already exists — update it
          const { data: existing } = await (supabase as any)
            .from('timecards')
            .select('id')
            .eq('shift_id', shift_id)
            .eq('nurse_id', user.userId)
            .single()

          if (existing?.id) {
            const { data: updated } = await (supabase as any)
              .from('timecards')
              .update({ clock_in_at: now })
              .eq('id', existing.id)
              .select()
              .single()

            await writeAuditLog({
              actor_id: user.userId,
              action: 'timecard.clock_in',
              target_type: 'timecard',
              target_id: existing.id,
              facility_id: shift.facility_id,
              metadata: { shift_id, clock_in_at: now },
              ip_address,
            })

            return NextResponse.json({ timecard: updated })
          }
        }
        throw insertError
      }

      await writeAuditLog({
        actor_id: user.userId,
        action: 'timecard.clock_in',
        target_type: 'timecard',
        target_id: timecard?.id,
        facility_id: shift.facility_id,
        metadata: { shift_id, clock_in_at: now },
        ip_address,
      })

      return NextResponse.json({ timecard }, { status: 201 })

    } else {
      // Updating an existing timecard
      const { data: existing, error: fetchError } = await (supabase as any)
        .from('timecards')
        .select('id, shift_id, nurse_id, facility_id')
        .eq('id', id)
        .single()

      if (fetchError || !existing) {
        return NextResponse.json({ error: 'Timecard not found' }, { status: 404 })
      }

      if (existing.nurse_id !== user.userId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const { data: timecard, error: updateError } = await (supabase as any)
        .from('timecards')
        .update({ clock_in_at: now })
        .eq('id', id)
        .select()
        .single()

      if (updateError) throw updateError

      await writeAuditLog({
        actor_id: user.userId,
        action: 'timecard.clock_in',
        target_type: 'timecard',
        target_id: id,
        facility_id: existing.facility_id,
        metadata: { shift_id: existing.shift_id, clock_in_at: now },
        ip_address,
      })

      return NextResponse.json({ timecard })
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Timecards ClockIn] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
