/**
 * POST /api/marketplace/apply
 *
 * Nurse applies to an open shift in the marketplace.
 *
 * Body: { shift_id: string }
 *
 * Validates:
 *   - Shift is still 'open'
 *   - Nurse hasn't already applied
 *   - Nurse compliance score >= 60
 *   - Shift isn't already filled
 *
 * Side effects:
 *   - Creates shift_application record
 *   - Creates in-app notification for facility admin
 *   - Audit log: action='marketplace.shift_applied'
 *
 * HIPAA: No PHI in logs or notifications metadata.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedUser } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'
import { createInAppNotification } from '@/lib/notifications/in-app-notifications'

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const user = await getAuthenticatedUser(supabase)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (user.role !== 'nurse') {
      return NextResponse.json({ error: 'Forbidden: nurse access only' }, { status: 403 })
    }

    // ── Parse body ─────────────────────────────────────────────────────────
    let body: { shift_id?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { shift_id } = body
    if (!shift_id || typeof shift_id !== 'string') {
      return NextResponse.json({ error: 'shift_id is required' }, { status: 400 })
    }

    // ── 1. Fetch shift ─────────────────────────────────────────────────────
    const { data: shift, error: shiftError } = await (supabase as any)
      .from('shifts')
      .select('id, facility_id, status, title, start_time, hourly_rate, specialty_required')
      .eq('id', shift_id)
      .single()

    if (shiftError || !shift) {
      return NextResponse.json({ error: 'Shift not found' }, { status: 404 })
    }

    if (shift.status !== 'open') {
      return NextResponse.json(
        { error: 'This shift is no longer open for applications' },
        { status: 409 }
      )
    }

    // ── 2. Check for duplicate application ────────────────────────────────
    const { data: existingApp } = await (supabase as any)
      .from('shift_applications')
      .select('id, status')
      .eq('shift_id', shift_id)
      .eq('nurse_id', user.userId)
      .single()

    if (existingApp) {
      if (existingApp.status !== 'withdrawn') {
        return NextResponse.json(
          { error: 'You have already applied to this shift' },
          { status: 409 }
        )
      }
    }

    // ── 3. Check compliance score >= 60 ───────────────────────────────────
    const { data: complianceRow } = await (supabase as any)
      .from('compliance_scores')
      .select('score')
      .eq('nurse_id', user.userId)
      .order('computed_at', { ascending: false })
      .limit(1)
      .single()

    const complianceScore: number = complianceRow?.score ?? 0
    if (complianceScore < 60) {
      return NextResponse.json(
        {
          error: 'COMPLIANCE_SCORE_TOO_LOW',
          message: `Your compliance score (${Math.round(complianceScore)}) must be at least 60 to apply to marketplace shifts.`,
          score: complianceScore,
        },
        { status: 403 }
      )
    }

    // ── 4. Create application ─────────────────────────────────────────────
    // If there's a withdrawn application, update it; otherwise insert
    let application: any
    if (existingApp?.status === 'withdrawn') {
      const { data: updated, error: updateError } = await (supabase as any)
        .from('shift_applications')
        .update({
          status: 'pending',
          applied_at: new Date().toISOString(),
          reviewed_at: null,
          reviewed_by: null,
          note: null,
        })
        .eq('id', existingApp.id)
        .select()
        .single()

      if (updateError) throw updateError
      application = updated
    } else {
      const { data: inserted, error: insertError } = await (supabase as any)
        .from('shift_applications')
        .insert({
          shift_id,
          nurse_id: user.userId,
          facility_id: shift.facility_id,
          status: 'pending',
          applied_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (insertError) throw insertError
      application = inserted
    }

    // ── 5. Notify facility admins ─────────────────────────────────────────
    try {
      const { data: admins } = await (supabase as any)
        .from('facility_admins')
        .select('profile_id')
        .eq('facility_id', shift.facility_id)

      for (const admin of admins ?? []) {
        await createInAppNotification(
          admin.profile_id,
          'shift_offer',
          'New Application Received',
          `A nurse has applied to a shift. Review applicants to accept or reject.`,
          { shift_id, application_id: application.id, facility_id: shift.facility_id },
          shift.facility_id
        )
      }
    } catch (notifyErr) {
      // Non-fatal — log and continue
      console.warn('[Marketplace Apply] Notification failed:', notifyErr)
    }

    // ── 6. Audit log ──────────────────────────────────────────────────────
    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: user.userId,
      action: 'marketplace.shift_applied',
      target_type: 'shift',
      target_id: shift_id,
      facility_id: shift.facility_id,
      metadata: {
        application_id: application.id,
        shift_id,
        facility_id: shift.facility_id,
        // Non-PHI context only
      },
      ip_address,
    })

    return NextResponse.json(
      { application, message: 'Application submitted successfully' },
      { status: 201 }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Marketplace Apply POST] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
