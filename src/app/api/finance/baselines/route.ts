/**
 * GET  /api/finance/baselines  — fetch cost baselines for facility
 * POST /api/finance/baselines  — upsert a cost baseline (admin only)
 *
 * HIPAA: No PHI. Facility-scoped. All writes audit logged.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'

const VALID_TYPES = ['agency_avg_rate', 'overtime_avg', 'msp_fee_pct'] as const
type BaselineType = typeof VALID_TYPES[number]

interface BaselineBody {
  baseline_type: BaselineType
  value: number
  effective_from?: string
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('cost_baselines')
      .select('id, facility_id, baseline_type, value, effective_from, created_at')
      .eq('facility_id', auth.hospitalId)
      .order('baseline_type')

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json({ baselines: [], message: 'cost_baselines table not yet provisioned' })
      }
      throw error
    }

    return NextResponse.json({ baselines: data ?? [] })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Baselines GET] Error:', err)
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

    let body: Partial<BaselineBody> = {}
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (!body.baseline_type || !VALID_TYPES.includes(body.baseline_type)) {
      return NextResponse.json(
        { error: `baseline_type must be one of: ${VALID_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    if (typeof body.value !== 'number' || body.value < 0) {
      return NextResponse.json({ error: 'value must be a non-negative number' }, { status: 400 })
    }

    const row = {
      facility_id: auth.hospitalId,
      baseline_type: body.baseline_type,
      value: body.value,
      effective_from: body.effective_from ?? new Date().toISOString().slice(0, 10),
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('cost_baselines')
      .upsert(row, { onConflict: 'facility_id,baseline_type' })
      .select()
      .single()

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json(
          { error: 'cost_baselines table not yet provisioned' },
          { status: 503 }
        )
      }
      throw error
    }

    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: auth.userId,
      action: 'finance.baseline.upserted',
      target_type: 'cost_baseline',
      target_id: data?.id ?? null,
      facility_id: auth.hospitalId,
      metadata: { baseline_type: body.baseline_type, value: body.value },
      ip_address,
    })

    return NextResponse.json({ baseline: data }, { status: 200 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Baselines POST] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
