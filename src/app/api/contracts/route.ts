/**
 * GET /api/contracts
 *
 * Admin only. Lists all contracts for the authenticated facility.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)
    const offset = parseInt(searchParams.get('offset') ?? '0', 10)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = (supabase as any)
      .from('contracts')
      .select(`
        id, title, status, pdf_url, signature_request_id,
        nurse_signed_at, admin_signed_at, voided_at, voided_reason,
        nurse_signature_url, admin_signature_url,
        nurse_id, facility_id, created_at, updated_at, expires_at,
        nurse:nurse_id (
          profiles:profile_id (
            full_name,
            email
          )
        ),
        shift:shift_id (
          title,
          start_time
        )
      `, { count: 'exact' })
      .eq('facility_id', auth.hospitalId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status) {
      query = query.eq('status', status)
    }

    const { data, count, error } = await query

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json({ contracts: [], total: 0 })
      }
      throw error
    }

    return NextResponse.json({
      contracts: data ?? [],
      total: count ?? 0,
      limit,
      offset,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Contracts GET] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
