/**
 * GET  /api/shifts — List shifts for the authenticated facility
 * POST /api/shifts — Create a new shift (facility must have a payment method)
 *
 * Payment enforcement: facilities without an active payment method receive a 402
 * before any shift data is persisted.
 *
 * Auth: Hospital admin only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'
import { hasValidPaymentMethod } from '@/lib/billing/payment-guard'
import { parseAndValidate, createShiftSchema } from '@/lib/validation/schemas'

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)
    const offset = parseInt(searchParams.get('offset') ?? '0', 10)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = supabase
      .from('shifts')
      .select('*', { count: 'exact' })
      .eq('facility_id', auth.hospitalId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status) {
      query = query.eq('status', status)
    }

    const { data, count, error } = await query

    if (error) throw error

    return NextResponse.json({ shifts: data ?? [], total: count ?? 0, limit, offset })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Shifts GET] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // ── Payment enforcement ────────────────────────────────────────────────
    const hasPayment = await hasValidPaymentMethod(auth.hospitalId)
    if (!hasPayment) {
      return NextResponse.json(
        {
          error: 'PAYMENT_METHOD_REQUIRED',
          message: 'Please add a payment method before posting shifts.',
          action_url: '/dashboard/billing',
        },
        { status: 402 }
      )
    }

    // ── Validate input ─────────────────────────────────────────────────────
    const [body, validationError] = await parseAndValidate(createShiftSchema, request)
    if (validationError) return validationError as unknown as NextResponse

    const {
      title, startTime, endTime, hourlyRate, specialty, requiredCertifications,
      acuityLevel, requiredCompetencies, minimumCompetencyScore, acuityNotes,
    } = body as typeof body & {
      acuityLevel?: string
      requiredCompetencies?: string[]
      minimumCompetencyScore?: number
      acuityNotes?: string
    }

    // Insert the shift
    const { data: shift, error: insertError } = await (supabase as any)
      .from('shifts')
      .insert({
        facility_id: auth.hospitalId,
        title,
        start_time: startTime,
        end_time: endTime,
        hourly_rate: hourlyRate ?? 0,
        specialty_required: specialty ?? null,
        status: 'open',
        description: requiredCertifications?.join(', ') ?? null,
        // ── Acuity fields (TIER 3) ──
        acuity_level: acuityLevel ?? null,
        required_competencies: requiredCompetencies ?? [],
        minimum_competency_score: minimumCompetencyScore ?? 60,
        acuity_notes: acuityNotes ?? null,
      })
      .select()
      .single()

    if (insertError) {
      console.error('[Shifts POST] Insert error:', insertError)
      return NextResponse.json({ error: 'Failed to create shift' }, { status: 500 })
    }

    // Audit log
    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: auth.userId,
      action: 'shift.created',
      target_type: 'shift',
      target_id: shift?.id,
      facility_id: auth.hospitalId,
      metadata: {
        title,
        start_time: startTime,
        end_time: endTime,
        hourly_rate: hourlyRate,
      },
      ip_address,
    })

    return NextResponse.json({ shift }, { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Shifts POST] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
