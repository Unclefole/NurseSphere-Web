/**
 * POST /api/timecards/[id]/approve
 *
 * Admin approves a timecard → status: 'approved'.
 * Triggers invoice + nurse payout via billing APIs.
 * Admin only, validates facility access.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'
import { notifyInvoiceCreated, notifyTimecardApproved } from '@/lib/notifications/notification-service'

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * Trigger invoice creation on shift completion.
 * Creates an invoice record and optionally notifies the facility admin.
 */
async function triggerInvoiceOnShiftCompletion(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  timecardId: string,
  facilityId: string,
  nurseId: string,
  shiftId: string,
  totalHours: number,
  hourlyRate: number
): Promise<{ invoiceId: string | null; amount: number }> {
  const amount = Math.round(totalHours * hourlyRate * 100) / 100 // round to cents
  const invoiceNumber = `INV-TC-${timecardId.slice(0, 8).toUpperCase()}`
  const shiftDate = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })

  try {
    const { data: invoice, error } = await (supabase as any)
      .from('invoices')
      .insert({
        facility_id: facilityId,
        invoice_number: invoiceNumber,
        status: 'pending',
        total: amount,
        description: `Timecard approved — shift ${shiftId}`,
        shift_ids: [shiftId],
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error && error.code !== '42P01') {
      console.warn('[Timecards Approve] Invoice insert warning:', error.message)
    }

    const invoiceId = invoice?.id ?? null

    // Notify facility admin via email
    if (invoiceId) {
      notifyInvoiceCreated(facilityId, invoiceId, amount).catch(() => { /* swallow */ })
    }

    return { invoiceId, amount }
  } catch {
    // Non-fatal — timecard still approved even if invoice fails
    return { invoiceId: null, amount }
  }
}

/**
 * Trigger nurse payout via internal billing API.
 * Non-fatal — approval proceeds even if payout initiation fails.
 */
async function triggerNursePayout(
  facilityId: string,
  nurseId: string,
  amount: number,
  shiftId: string,
  appUrl: string
): Promise<void> {
  try {
    const payoutRes = await fetch(`${appUrl}/api/billing/payout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nurse_id: nurseId, amount, shift_id: shiftId }),
    })
    if (!payoutRes.ok) {
      const body = await payoutRes.text().catch(() => '')
      console.warn(`[Timecards Approve] Payout returned ${payoutRes.status}: ${body.slice(0, 200)}`)
    }
  } catch (err) {
    console.warn('[Timecards Approve] Payout request failed (non-fatal):', err)
  }
}

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized — admin access required' }, { status: 401 })
    }

    // Fetch timecard
    const { data: timecard, error: fetchError } = await (supabase as any)
      .from('timecards')
      .select('id, shift_id, nurse_id, facility_id, status, total_hours, clock_in_at, clock_out_at, break_minutes')
      .eq('id', id)
      .single()

    if (fetchError || !timecard) {
      return NextResponse.json({ error: 'Timecard not found' }, { status: 404 })
    }

    // Validate facility access
    if (timecard.facility_id !== auth.hospitalId) {
      return NextResponse.json({ error: 'Forbidden — timecard belongs to a different facility' }, { status: 403 })
    }

    if (timecard.status === 'approved' || timecard.status === 'paid') {
      return NextResponse.json({ error: `Timecard is already ${timecard.status}` }, { status: 422 })
    }

    if (!timecard.clock_out_at) {
      return NextResponse.json({ error: 'Cannot approve timecard without clock-out' }, { status: 422 })
    }

    const now = new Date().toISOString()
    const totalHours = Number(timecard.total_hours ?? 0)

    // Fetch hourly rate from shift
    const { data: shift } = await (supabase as any)
      .from('shifts')
      .select('hourly_rate')
      .eq('id', timecard.shift_id)
      .single()
    const hourlyRate = Number((shift as any)?.hourly_rate ?? 0)
    const grossAmount = Math.round(totalHours * hourlyRate * 100) / 100

    // Approve the timecard
    const { data: updated, error: updateError } = await (supabase as any)
      .from('timecards')
      .update({
        status: 'approved',
        approved_by: auth.userId,
        approved_at: now,
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError) throw updateError

    // Trigger invoice creation
    const { invoiceId, amount } = await triggerInvoiceOnShiftCompletion(
      supabase,
      id,
      timecard.facility_id,
      timecard.nurse_id,
      timecard.shift_id,
      totalHours,
      hourlyRate
    )

    // Trigger nurse payout (non-fatal, fire-and-forget)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    triggerNursePayout(timecard.facility_id, timecard.nurse_id, grossAmount, timecard.shift_id, appUrl).catch(
      () => { /* swallow */ }
    )

    // Notify nurse of approval (push + in-app, non-fatal)
    notifyTimecardApproved(
      timecard.nurse_id,
      id,
      timecard.facility_id,
      timecard.clock_in_at
    ).catch(() => { /* swallow */ })

    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: auth.userId,
      action: 'timecard.approved',
      target_type: 'timecard',
      target_id: id,
      facility_id: timecard.facility_id,
      metadata: {
        nurse_id: timecard.nurse_id,
        shift_id: timecard.shift_id,
        total_hours: totalHours,
        hourly_rate: hourlyRate,
        amount: grossAmount,
        invoice_id: invoiceId,
      },
      ip_address,
    })

    return NextResponse.json({
      timecard: updated,
      invoice_id: invoiceId,
      amount: grossAmount,
      total_hours: totalHours,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Timecards Approve] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
