/**
 * POST /api/shifts/[id]/complete
 *
 * Admin-only: marks a shift as 'completed' and automatically triggers invoice generation.
 *
 * Auth: Hospital admin only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'
import { triggerInvoiceOnShiftCompletion } from '@/lib/billing/invoice-trigger'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: shiftId } = await params
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch the shift to validate ownership + current status
    const { data: shiftRaw, error: fetchError } = await (supabase as any)
      .from('shifts')
      .select('id, facility_id, status, title, nurse_id')
      .eq('id', shiftId)
      .single()

    if (fetchError || !shiftRaw) {
      return NextResponse.json({ error: 'Shift not found' }, { status: 404 })
    }

    const shift = shiftRaw as {
      id: string
      facility_id: string
      status: string
      title: string
      nurse_id: string | null
    }

    // Verify the shift belongs to this facility
    if (shift.facility_id !== auth.hospitalId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Idempotency: already completed
    if (shift.status === 'completed') {
      return NextResponse.json({
        success: true,
        message: 'Shift is already completed',
        shift_id: shiftId,
      })
    }

    // Only in_progress or filled shifts can be completed
    if (!['in_progress', 'filled'].includes(shift.status)) {
      return NextResponse.json(
        {
          error: `Cannot complete shift with status '${shift.status}'. Must be 'in_progress' or 'filled'.`,
        },
        { status: 422 }
      )
    }

    // Mark shift as completed
    const { error: updateError } = await (supabase as any)
      .from('shifts')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', shiftId)

    if (updateError) {
      console.error('[ShiftComplete] Failed to update shift:', updateError)
      return NextResponse.json({ error: 'Failed to complete shift' }, { status: 500 })
    }

    // Audit log: shift completion
    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: auth.userId,
      action: 'shift.completed',
      target_type: 'shift',
      target_id: shiftId,
      facility_id: auth.hospitalId,
      metadata: {
        shift_title: shift.title,
        nurse_id: shift.nurse_id,
        previous_status: shift.status,
      },
      ip_address,
    })

    // Trigger invoice generation (fire-and-forget — never blocks response)
    triggerInvoiceOnShiftCompletion(shiftId, shift.facility_id, auth.userId).catch((err) => {
      console.error('[ShiftComplete] Invoice trigger failed:', err)
    })

    return NextResponse.json({
      success: true,
      message: 'Shift marked as completed. Invoice generation initiated.',
      shift_id: shiftId,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[ShiftComplete] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
