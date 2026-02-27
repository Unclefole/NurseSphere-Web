/**
 * GET /api/credentials?nurse_id=<uuid>
 *
 * Returns credentials for a nurse. Requires hospital admin session.
 * Scoped to the admin's facility.
 */

import { NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { createClient } from '@supabase/supabase-js'

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient()
  const admin = await getAuthenticatedHospital(supabase)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const nurseId = searchParams.get('nurse_id')
  if (!nurseId) {
    return NextResponse.json({ error: 'nurse_id is required' }, { status: 400 })
  }

  const adminClient = createAdminClient()
  const { data, error } = await adminClient
    .from('credentials')
    .select('id, nurse_id, facility_id, type, issuing_state, number, status, expiration_date, verified_at, verified_by, source, created_at')
    .eq('nurse_id', nurseId)
    .eq('facility_id', admin.hospitalId)
    .order('expiration_date', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ credentials: data ?? [] })
}
