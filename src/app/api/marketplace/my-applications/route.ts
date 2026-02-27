/**
 * GET /api/marketplace/my-applications
 *
 * Returns the authenticated nurse's own shift applications with shift details.
 *
 * Query params:
 *   ?status=pending|accepted|rejected|withdrawn|expired — filter by status
 *
 * RLS ensures nurses only see their own data.
 * HIPAA: No other nurse data returned.
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

    if (user.role !== 'nurse') {
      return NextResponse.json({ error: 'Forbidden: nurse access only' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = (supabase as any)
      .from('shift_applications')
      .select(`
        id,
        shift_id,
        facility_id,
        status,
        applied_at,
        reviewed_at,
        note,
        created_at,
        updated_at,
        shifts:shift_id (
          id,
          title,
          start_time,
          end_time,
          hourly_rate,
          specialty_required,
          status,
          description
        ),
        facilities:facility_id (
          id,
          name,
          city,
          state
        )
      `)
      .eq('nurse_id', user.userId)
      .order('applied_at', { ascending: false })

    if (status) {
      const validStatuses = ['pending', 'accepted', 'rejected', 'withdrawn', 'expired']
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ error: 'Invalid status filter' }, { status: 400 })
      }
      query = query.eq('status', status)
    }

    const { data, error } = await query

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json({ applications: [] })
      }
      throw error
    }

    return NextResponse.json({ applications: data ?? [] })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Marketplace My-Applications GET] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * DELETE /api/marketplace/my-applications?application_id=xxx
 *
 * Nurse withdraws a pending application.
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const user = await getAuthenticatedUser(supabase)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (user.role !== 'nurse') {
      return NextResponse.json({ error: 'Forbidden: nurse access only' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const applicationId = searchParams.get('application_id')

    if (!applicationId) {
      return NextResponse.json({ error: 'application_id is required' }, { status: 400 })
    }

    // Verify ownership and pending status
    const { data: app, error: fetchErr } = await (supabase as any)
      .from('shift_applications')
      .select('id, status, nurse_id, shift_id, facility_id')
      .eq('id', applicationId)
      .eq('nurse_id', user.userId)
      .single()

    if (fetchErr || !app) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 })
    }

    if (app.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot withdraw application with status '${app.status}'` },
        { status: 409 }
      )
    }

    const { error: updateErr } = await (supabase as any)
      .from('shift_applications')
      .update({ status: 'withdrawn' })
      .eq('id', applicationId)
      .eq('nurse_id', user.userId)

    if (updateErr) throw updateErr

    return NextResponse.json({ message: 'Application withdrawn' })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Marketplace My-Applications DELETE] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
