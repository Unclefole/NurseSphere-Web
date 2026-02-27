/**
 * POST /api/verification/nurse/[id]
 *
 * Triggers a full credential verification run for a nurse.
 * Protected: requires facility admin session.
 *
 * Body: (optional)
 *   { facility_id?: string }  — override facility context
 *
 * Response:
 *   200 { summary: VerificationSummary }
 *   401 Unauthorized
 *   403 Forbidden (not a facility admin)
 *   500 Verification failed
 */

import { NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { runNurseVerification } from '@/lib/verification/verify-nurse'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // ── Auth check: facility admin only ─────────────────────────────────────────
  const supabase = await createSupabaseServerClient()
  const admin = await getAuthenticatedHospital(supabase)

  if (!admin) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Facility admin session required' },
      { status: 401 },
    )
  }

  const { id: nurseId } = await params
  if (!nurseId) {
    return NextResponse.json({ error: 'Missing nurse id' }, { status: 400 })
  }

  // Parse optional body
  let facilityIdOverride: string | null = null
  try {
    const body = await request.json().catch(() => ({}))
    facilityIdOverride = typeof body?.facility_id === 'string' ? body.facility_id : null
  } catch {
    // no body — fine
  }

  const facilityId = facilityIdOverride ?? admin.hospitalId
  const { ip_address } = extractRequestMeta(request)

  // Audit: verification triggered
  await writeAuditLog({
    actor_id: admin.userId,
    facility_id: facilityId,
    action: 'verification.triggered',
    target_id: nurseId,
    target_type: 'nurse',
    metadata: { facility_id: facilityId },
    ip_address,
  })

  try {
    const summary = await runNurseVerification(nurseId, facilityId, admin.userId)

    return NextResponse.json({ summary })
  } catch (err) {
    console.error('[API] /api/verification/nurse/[id] error:', err)
    return NextResponse.json(
      { error: 'Verification failed', detail: String(err) },
      { status: 500 },
    )
  }
}

/**
 * GET /api/verification/nurse/[id]
 *
 * Returns verification history for a nurse (most recent 20 runs).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient()
  const admin = await getAuthenticatedHospital(supabase)

  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: nurseId } = await params
  if (!nurseId) {
    return NextResponse.json({ error: 'Missing nurse id' }, { status: 400 })
  }

  try {
    // Use admin client for read — the user's session may not have RLS access
    // to verifications at all facilities. We scope by the admin's facility.
    const { createSupabaseAdminClient } = await import('@/lib/supabase-server')
    const adminClient = createSupabaseAdminClient()

    const { data, error } = await adminClient
      .from('credential_verifications')
      .select('id, verification_type, result, verified_at, expires_at, notes, raw_response')
      .eq('nurse_id', nurseId)
      .eq('facility_id', admin.hospitalId)
      .order('verified_at', { ascending: false })
      .limit(50)

    if (error) {
      console.warn('[API] credential_verifications read error:', error.message)
      // Phantom guard — table may not exist yet
      return NextResponse.json({ verifications: [] })
    }

    return NextResponse.json({ verifications: data ?? [] })
  } catch (err) {
    console.error('[API] GET /api/verification/nurse/[id] error:', err)
    return NextResponse.json({ error: 'Failed to fetch verifications' }, { status: 500 })
  }
}
