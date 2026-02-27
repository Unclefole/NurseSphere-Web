/**
 * GET  /api/nurses/[id]/competencies — List nurse competencies (admin-only)
 * POST /api/nurses/[id]/competencies — Add/update nurse competency (admin-only)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { getNurseCompetencies, upsertCompetency } from '@/lib/acuity/competency-service'
import { extractRequestMeta, writeAuditLog } from '@/lib/audit'
import type { UnitType } from '@/lib/acuity/competency-service'

interface RouteParams {
  params: Promise<{ id: string }>
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: nurseId } = await params
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const competencies = await getNurseCompetencies(nurseId)

    return NextResponse.json({ competencies })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: nurseId } = await params
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { unit_type, hours_last_12mo, last_worked_at, verified } = body as {
      unit_type: UnitType
      hours_last_12mo: number
      last_worked_at: string | null
      verified: boolean
    }

    if (!unit_type) {
      return NextResponse.json({ error: 'unit_type is required' }, { status: 400 })
    }

    const verifiedBy = verified ? auth.userId : undefined

    const competency = await upsertCompetency(
      nurseId,
      unit_type,
      hours_last_12mo ?? 0,
      last_worked_at ? new Date(last_worked_at) : null,
      verifiedBy
    )

    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: auth.userId,
      action: 'competency.admin_updated',
      target_type: 'competency',
      target_id: competency.id,
      facility_id: auth.hospitalId,
      metadata: {
        nurse_id: nurseId,
        unit_type,
        hours_last_12mo,
        verified,
      },
      ip_address,
    })

    return NextResponse.json({ competency }, { status: 200 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[NurseCompetencies POST] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
