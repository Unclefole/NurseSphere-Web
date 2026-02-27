/**
 * GET /api/contracts/[id]
 *
 * Fetch a single contract by ID.
 * Accessible by the contract's nurse or facility admin.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { id: contractId } = await context.params

  try {
    const supabase = await createSupabaseServerClient()

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: contractRaw, error } = await supabase
      .from('contracts')
      .select('id, facility_id, nurse_id, status, title, content, signed_at, created_at, updated_at, template_id, rate, start_date, end_date')
      .eq('id', contractId)
      .single()

    if (error || !contractRaw) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
    }

    const contract = contractRaw as Record<string, unknown>

    // Access control: nurse can only see their own contract; admin sees facility contracts
    const nurseId = contract.nurse_id as string
    const facilityId = contract.facility_id as string

    if (user.id !== nurseId) {
      // Check if user is a facility admin
      const { data: adminRow } = await supabase
        .from('facility_admins')
        .select('facility_id')
        .eq('profile_id', user.id)
        .eq('facility_id', facilityId)
        .single()

      if (!adminRow) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    return NextResponse.json({ contract })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Contract GET] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
