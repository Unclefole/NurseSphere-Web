/**
 * GET /api/marketplace/shifts
 *
 * Returns open shifts across ALL facilities for nurse browsing.
 * Nurse-authenticated only.
 *
 * Query params:
 *   ?role=RN        — filter by specialty_required
 *   ?unit=ICU       — filter by department/unit
 *   ?min_rate=40    — minimum hourly_rate
 *   ?date=2026-03-01 — filter shifts starting on this date (YYYY-MM-DD)
 *   ?facility_id=   — filter by specific facility
 *   ?shift_type=day|night|weekend — filter by shift type
 *   ?limit=50       — max results (capped at 200)
 *   ?offset=0       — pagination
 *
 * HIPAA: Returns only shift data + facility name + application count.
 * Does NOT return individual nurse data.
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
    const role        = searchParams.get('role')
    const unit        = searchParams.get('unit')
    const minRate     = searchParams.get('min_rate')
    const date        = searchParams.get('date')
    const facilityId  = searchParams.get('facility_id')
    const shiftType   = searchParams.get('shift_type')
    const limit       = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)
    const offset      = parseInt(searchParams.get('offset') ?? '0', 10)

    // ── 1. Fetch nurse's existing applications (to exclude) ────────────────
    const { data: myApps } = await (supabase as any)
      .from('shift_applications')
      .select('shift_id')
      .eq('nurse_id', user.userId)
      .not('status', 'eq', 'withdrawn')

    const appliedShiftIds: string[] = (myApps ?? []).map((a: any) => a.shift_id)

    // ── 2. Build open shifts query ──────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = (supabase as any)
      .from('shifts')
      .select(`
        id,
        facility_id,
        title,
        start_time,
        end_time,
        hourly_rate,
        specialty_required,
        description,
        status,
        created_at,
        facilities:facility_id (
          id,
          name,
          city,
          state
        )
      `, { count: 'exact' })
      .eq('status', 'open')
      .order('start_time', { ascending: true })
      .order('hourly_rate', { ascending: false })
      .range(offset, offset + limit - 1)

    // Exclude shifts already applied to
    if (appliedShiftIds.length > 0) {
      query = query.not('id', 'in', `(${appliedShiftIds.join(',')})`)
    }

    // Filters
    if (role)       query = query.ilike('specialty_required', `%${role}%`)
    if (unit)       query = query.ilike('description', `%${unit}%`)
    if (facilityId) query = query.eq('facility_id', facilityId)
    if (minRate)    query = query.gte('hourly_rate', parseFloat(minRate))

    if (date) {
      // Filter shifts starting on the given date (UTC day boundaries)
      const start = `${date}T00:00:00.000Z`
      const end   = `${date}T23:59:59.999Z`
      query = query.gte('start_time', start).lte('start_time', end)
    }

    if (shiftType === 'night') {
      // Night shifts: start_time hour >= 18 or <= 6 — approximate with title search
      query = query.ilike('title', '%night%')
    } else if (shiftType === 'weekend') {
      // Weekend filter handled client-side (Supabase doesn't have DOW extraction easily)
    }

    const { data: shifts, count, error } = await query

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json({ shifts: [], total: 0, limit, offset })
      }
      throw error
    }

    // ── 3. Fetch application counts per shift (not individual applicants) ──
    const shiftIds = (shifts ?? []).map((s: any) => s.id)
    let appCounts: Record<string, number> = {}

    if (shiftIds.length > 0) {
      const { data: countRows } = await (supabase as any)
        .from('shift_applications')
        .select('shift_id')
        .in('shift_id', shiftIds)
        .eq('status', 'pending')

      for (const row of countRows ?? []) {
        appCounts[row.shift_id] = (appCounts[row.shift_id] ?? 0) + 1
      }
    }

    // ── 4. Shape response — no PHI ─────────────────────────────────────────
    const result = (shifts ?? []).map((s: any) => ({
      id: s.id,
      facility_id: s.facility_id,
      facility_name: s.facilities?.name ?? 'Unknown Facility',
      facility_city: s.facilities?.city ?? null,
      facility_state: s.facilities?.state ?? null,
      title: s.title,
      start_time: s.start_time,
      end_time: s.end_time,
      hourly_rate: s.hourly_rate,
      specialty_required: s.specialty_required,
      description: s.description,
      status: s.status,
      application_count: appCounts[s.id] ?? 0,
      created_at: s.created_at,
    }))

    return NextResponse.json({ shifts: result, total: count ?? 0, limit, offset })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Marketplace Shifts GET] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
