/**
 * POST /api/credentials/verify
 *
 * Admin verifies a credential — sets verified_at, verified_by, status='active'.
 * Audit-logged per HIPAA.
 *
 * Body: { credential_id: string }
 */

import { NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { createClient } from '@supabase/supabase-js'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const admin = await getAuthenticatedHospital(supabase)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { credential_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { credential_id } = body
  if (!credential_id) {
    return NextResponse.json({ error: 'credential_id is required' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  // Fetch credential to verify it belongs to this facility
  const { data: credential, error: fetchErr } = await adminClient
    .from('credentials')
    .select('id, nurse_id, facility_id, type, status')
    .eq('id', credential_id)
    .single()

  if (fetchErr || !credential) {
    return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
  }

  // Verify the credential belongs to this admin's facility
  if (credential.facility_id && credential.facility_id !== admin.hospitalId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const now = new Date().toISOString()

  const { data: updated, error: updateErr } = await adminClient
    .from('credentials')
    .update({
      status: 'active',
      verified_at: now,
      verified_by: admin.userId,
    })
    .eq('id', credential_id)
    .select()
    .single()

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  const { ip_address } = extractRequestMeta(request)
  await writeAuditLog({
    actor_id: admin.userId,
    action: 'credential_verified',
    target_type: 'credentials',
    target_id: credential_id,
    facility_id: admin.hospitalId,
    metadata: {
      nurse_id: credential.nurse_id,
      credential_type: credential.type,
      previous_status: credential.status,
      verified_at: now,
    },
    ip_address,
  })

  return NextResponse.json({ credential: updated })
}
