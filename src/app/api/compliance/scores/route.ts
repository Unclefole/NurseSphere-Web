/**
 * GET /api/compliance/scores
 *
 * Returns compliance scores for the authenticated facility admin's facility.
 * Optional: ?nurse_id=<uuid> for single nurse view.
 *
 * HIPAA: no PHI in response — only scores, reasons, and timestamps.
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

  const adminClient = createAdminClient()
  let query = adminClient
    .from('compliance_scores')
    .select(
      `
      id,
      facility_id,
      nurse_id,
      score,
      reasons,
      computed_at,
      profiles!compliance_scores_nurse_id_fkey(id, full_name, avatar_url)
    `
    )
    .eq('facility_id', admin.hospitalId)
    .order('score', { ascending: true })

  if (nurseId) {
    query = query.eq('nurse_id', nurseId) as typeof query
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ scores: data ?? [] })
}
