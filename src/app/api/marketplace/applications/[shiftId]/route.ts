/**
 * GET  /api/marketplace/applications/[shiftId] — Admin: list applicants for a shift
 * PATCH /api/marketplace/applications/[shiftId] — Admin: accept or reject an application
 *
 * Admin only (facility_admins check).
 * HIPAA: Returns nurse name + compliance score only; no PHI.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedUser, createSupabaseAdminClient } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'
import { createInAppNotification } from '@/lib/notifications/in-app-notifications'

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getAdminFacility(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string
): Promise<string | null> {
  const { data } = await (supabase as any)
    .from('facility_admins')
    .select('facility_id')
    .eq('profile_id', userId)
    .limit(1)
    .single()
  return data?.facility_id ?? null
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shiftId: string }> }
): Promise<NextResponse> {
  try {
    const { shiftId } = await params
    const supabase = await createSupabaseServerClient()
    const user = await getAuthenticatedUser(supabase)

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (user.role !== 'admin' && user.role !== 'hospital_admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const facilityId = await getAdminFacility(supabase, user.userId)
    if (!facilityId) {
      return NextResponse.json({ error: 'No facility found for admin' }, { status: 403 })
    }

    // Verify the shift belongs to admin's facility
    const { data: shift } = await (supabase as any)
      .from('shifts')
      .select('id, facility_id')
      .eq('id', shiftId)
      .eq('facility_id', facilityId)
      .single()

    if (!shift) {
      return NextResponse.json({ error: 'Shift not found or access denied' }, { status: 404 })
    }

    // Fetch applications with nurse name + compliance score (no PHI)
    const { data: applications, error } = await (supabase as any)
      .from('shift_applications')
      .select(`
        id,
        nurse_id,
        status,
        applied_at,
        reviewed_at,
        note,
        profiles:nurse_id (
          full_name
        )
      `)
      .eq('shift_id', shiftId)
      .order('applied_at', { ascending: true })

    if (error) throw error

    // Fetch compliance scores separately to avoid joins
    const nurseIds = (applications ?? []).map((a: any) => a.nurse_id)
    let scoreMap: Record<string, number> = {}

    if (nurseIds.length > 0) {
      const adminSupabase = createSupabaseAdminClient()
      // Get latest score per nurse
      const { data: scores } = await (adminSupabase as any)
        .from('compliance_scores')
        .select('nurse_id, score')
        .in('nurse_id', nurseIds)
        .order('computed_at', { ascending: false })

      // Deduplicate — first score per nurse is latest
      for (const s of scores ?? []) {
        if (!(s.nurse_id in scoreMap)) {
          scoreMap[s.nurse_id] = s.score
        }
      }
    }

    const result = (applications ?? []).map((a: any) => ({
      id: a.id,
      nurse_id: a.nurse_id,
      nurse_name: a.profiles?.full_name ?? 'Unknown',
      compliance_score: scoreMap[a.nurse_id] ?? null,
      status: a.status,
      applied_at: a.applied_at,
      reviewed_at: a.reviewed_at,
      note: a.note,
    }))

    return NextResponse.json({ applications: result, shift_id: shiftId })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Marketplace Applications GET] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ shiftId: string }> }
): Promise<NextResponse> {
  try {
    const { shiftId } = await params
    const supabase = await createSupabaseServerClient()
    const user = await getAuthenticatedUser(supabase)

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (user.role !== 'admin' && user.role !== 'hospital_admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const facilityId = await getAdminFacility(supabase, user.userId)
    if (!facilityId) {
      return NextResponse.json({ error: 'No facility found for admin' }, { status: 403 })
    }

    // Parse body
    let body: { application_id: string; decision: 'accept' | 'reject'; note?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { application_id, decision, note } = body

    if (!application_id || !decision) {
      return NextResponse.json(
        { error: 'application_id and decision (accept|reject) are required' },
        { status: 400 }
      )
    }

    if (!['accept', 'reject'].includes(decision)) {
      return NextResponse.json({ error: "decision must be 'accept' or 'reject'" }, { status: 400 })
    }

    // Verify shift belongs to admin's facility
    const { data: shift } = await (supabase as any)
      .from('shifts')
      .select('id, facility_id, status')
      .eq('id', shiftId)
      .eq('facility_id', facilityId)
      .single()

    if (!shift) {
      return NextResponse.json({ error: 'Shift not found or access denied' }, { status: 404 })
    }

    // Fetch the target application
    const { data: app } = await (supabase as any)
      .from('shift_applications')
      .select('id, nurse_id, status')
      .eq('id', application_id)
      .eq('shift_id', shiftId)
      .single()

    if (!app) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 })
    }

    if (app.status !== 'pending') {
      return NextResponse.json(
        { error: `Application is already '${app.status}'` },
        { status: 409 }
      )
    }

    const now = new Date().toISOString()
    const { ip_address } = extractRequestMeta(request)
    const adminSupabase = createSupabaseAdminClient()

    if (decision === 'accept') {
      // 1. Accept this application
      const { error: acceptErr } = await (adminSupabase as any)
        .from('shift_applications')
        .update({
          status: 'accepted',
          reviewed_at: now,
          reviewed_by: user.userId,
          note: note ?? null,
        })
        .eq('id', application_id)

      if (acceptErr) throw acceptErr

      // 2. Update shift status to 'assigned'
      const { error: shiftErr } = await (adminSupabase as any)
        .from('shifts')
        .update({ status: 'filled' })
        .eq('id', shiftId)

      if (shiftErr) throw shiftErr

      // 3. Reject all other pending applications for this shift
      const { data: rejected } = await (adminSupabase as any)
        .from('shift_applications')
        .update({
          status: 'rejected',
          reviewed_at: now,
          reviewed_by: user.userId,
          note: 'Another applicant was selected.',
        })
        .eq('shift_id', shiftId)
        .eq('status', 'pending')
        .neq('id', application_id)
        .select('id, nurse_id')

      // 4. Notify accepted nurse
      await createInAppNotification(
        app.nurse_id,
        'shift_offer',
        'Application Accepted! 🎉',
        'Your application has been accepted. Check your schedule for details.',
        { shift_id: shiftId, application_id, facility_id: facilityId },
        facilityId
      )

      // 5. Notify rejected nurses
      for (const rejectedApp of rejected ?? []) {
        await createInAppNotification(
          rejectedApp.nurse_id,
          'shift_offer',
          'Application Not Selected',
          'Your application was reviewed. Another candidate was selected for this shift.',
          { shift_id: shiftId, application_id: rejectedApp.id, facility_id: facilityId },
          facilityId
        )
      }

      // 6. Audit log
      await writeAuditLog({
        actor_id: user.userId,
        action: 'marketplace.application_accepted',
        target_type: 'shift_application',
        target_id: application_id,
        facility_id: facilityId,
        metadata: {
          shift_id: shiftId,
          application_id,
          rejected_count: (rejected ?? []).length,
        },
        ip_address,
      })
    } else {
      // Reject only this application
      const { error: rejectErr } = await (adminSupabase as any)
        .from('shift_applications')
        .update({
          status: 'rejected',
          reviewed_at: now,
          reviewed_by: user.userId,
          note: note ?? null,
        })
        .eq('id', application_id)

      if (rejectErr) throw rejectErr

      // Notify rejected nurse
      await createInAppNotification(
        app.nurse_id,
        'shift_offer',
        'Application Not Selected',
        'Your application was reviewed but not selected for this shift.',
        { shift_id: shiftId, application_id, facility_id: facilityId },
        facilityId
      )

      // Audit log
      await writeAuditLog({
        actor_id: user.userId,
        action: 'marketplace.application_rejected',
        target_type: 'shift_application',
        target_id: application_id,
        facility_id: facilityId,
        metadata: { shift_id: shiftId, application_id },
        ip_address,
      })
    }

    return NextResponse.json({ message: `Application ${decision}ed successfully` })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Marketplace Applications PATCH] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
