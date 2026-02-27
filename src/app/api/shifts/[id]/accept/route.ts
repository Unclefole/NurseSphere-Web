/**
 * POST /api/shifts/[id]/accept
 *
 * Nurse-facing: Accept a shift.
 *
 * TIER 3 — Acuity + Litigation Defense Engine:
 *   1. Check feature flag `competency_guardrails` — if disabled, proceed without check
 *   2. Validate competency match (HIGH/CRITICAL shifts may be blocked)
 *   3. If blocked: return 403 with blockers + requiresOverride: true
 *   4. If allowed: generate risk certificate
 *   5. Accept shift
 *   6. Return success with certificateId
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'
import { featureFlags } from '@/lib/feature-flags'
import { validateCompetencyMatch } from '@/lib/acuity/competency-matching'
import { generateRiskCertificate } from '@/lib/acuity/risk-certificate'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: shiftId } = await params
    const supabase = await createSupabaseServerClient()

    // ── Auth ────────────────────────────────────────────────────────────────
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const nurseId = user.id

    // ── Fetch shift ─────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shiftRaw, error: shiftError } = await (supabase as any)
      .from('shifts')
      .select('id, facility_id, status, nurse_id')
      .eq('id', shiftId)
      .single()

    if (shiftError || !shiftRaw) {
      return NextResponse.json({ error: 'Shift not found' }, { status: 404 })
    }

    const shift = shiftRaw as {
      id: string
      facility_id: string
      status: string
      nurse_id: string | null
    }

    if (shift.status !== 'open') {
      return NextResponse.json(
        { error: `Shift is not available for acceptance (status: ${shift.status})` },
        { status: 422 }
      )
    }

    if (shift.nurse_id) {
      return NextResponse.json({ error: 'Shift has already been accepted' }, { status: 409 })
    }

    // ── Competency Guardrail ────────────────────────────────────────────────
    let certificateId: string | null = null

    if (featureFlags.competency_guardrails) {
      const matchResult = await validateCompetencyMatch(nurseId, shiftId)

      if (!matchResult.allowed) {
        return NextResponse.json(
          {
            error: 'COMPETENCY_MISMATCH',
            reason: matchResult.reason,
            blockers: matchResult.blockers,
            requiresOverride: true,
          },
          { status: 403 }
        )
      }
    }

    // ── Generate Risk Certificate (always if flag enabled) ──────────────────
    if (featureFlags.risk_certificates) {
      try {
        const certificate = await generateRiskCertificate(shiftId, nurseId)
        certificateId = certificate.id
      } catch (certErr) {
        // Don't block shift acceptance if cert generation fails — log and continue
        console.error('[ShiftAccept] Risk certificate generation failed:', certErr)
      }
    }

    // ── Accept shift ────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (supabase as any)
      .from('shifts')
      .update({
        status: 'filled',
        nurse_id: nurseId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', shiftId)

    if (updateError) {
      console.error('[ShiftAccept] Update error:', updateError)
      return NextResponse.json({ error: 'Failed to accept shift' }, { status: 500 })
    }

    // ── Audit log ───────────────────────────────────────────────────────────
    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: nurseId,
      action: 'shift.accepted',
      target_type: 'shift',
      target_id: shiftId,
      facility_id: shift.facility_id,
      metadata: {
        nurse_id: nurseId,
        certificate_id: certificateId,
        competency_guardrails_enabled: featureFlags.competency_guardrails,
      },
      ip_address,
    })

    return NextResponse.json({
      success: true,
      shiftId,
      certificateId,
      message: 'Shift accepted successfully.',
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[ShiftAccept] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
