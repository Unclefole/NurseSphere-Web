/**
 * Shift Start API
 * POST /api/shifts/[id]/start
 *
 * Runs validateBeforeShift() before allowing shift start.
 * Returns 403 with blockers if compliance check fails.
 * Returns 200 on success.
 *
 * Auth: authenticated user (nurse or admin).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase-server'
import { validateBeforeShift } from '@/lib/compliance/validate-before-shift'
import { writeAuditLog } from '@/lib/audit'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id: shiftId } = await params

    if (!shiftId) {
      return NextResponse.json({ error: 'Shift ID required' }, { status: 400 })
    }

    // Auth check
    const supabase = await createSupabaseServerClient()
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // ── Pre-shift compliance revalidation ────────────────────────────────────
    const validation = await validateBeforeShift(shiftId)

    if (!validation.allowed) {
      return NextResponse.json(
        {
          error: 'Shift blocked: compliance validation failed',
          reason: validation.reason,
          blockers: validation.blockers,
          shiftId,
        },
        { status: 403 },
      )
    }

    // ── Shift start logic ─────────────────────────────────────────────────────
    const adminClient = createSupabaseAdminClient()

    // Update shift status to 'in_progress'
    const { error: updateError } = await adminClient
      .from('shifts')
      .update({
        status: 'in_progress',
        started_at: new Date().toISOString(),
      })
      .eq('id', shiftId)

    if (updateError) {
      console.error('[API/shift-start] Failed to update shift status: %s', updateError.message)
      return NextResponse.json({ error: 'Failed to start shift' }, { status: 500 })
    }

    // Audit log shift start
    await writeAuditLog({
      actor_id: session.user.id,
      action: 'shift.started',
      target_id: shiftId,
      target_type: 'shift',
      metadata: { shiftId, nurse_id: validation.nurseId },
    })

    return NextResponse.json({
      success: true,
      shiftId,
      status: 'in_progress',
      revalidation: {
        passed: true,
        checkedAt: validation.checkedAt,
      },
    })
  } catch (err) {
    console.error('[API/shift-start] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
