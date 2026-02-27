/**
 * GET /api/team/invites
 *
 * Admin only. Lists all pending invites for the facility.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminSupabase = createSupabaseAdminClient() as any

    const { data, error } = await adminSupabase
      .from('admin_invites')
      .select('id, email, role, status, created_at, expires_at')
      .eq('facility_id', auth.hospitalId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json({ invites: [] })
      }
      throw error
    }

    return NextResponse.json({ invites: data ?? [] })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[TeamInvites GET] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
