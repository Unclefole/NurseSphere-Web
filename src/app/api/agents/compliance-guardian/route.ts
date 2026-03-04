/**
 * POST /api/agents/compliance-guardian
 *
 * Runs the ComplianceGuardian agent for a specific nurse or as a full nightly sweep.
 *
 * Auth:
 *   - Bearer CRON_SECRET  → cron/scheduled run
 *   - Authenticated super_admin or hospital_admin session
 *
 * Body (JSON):
 *   { nurseId?: string, facilityId?: string, mode?: 'nightly' | 'shift_booking' | 'onboarding' }
 *   If nurseId is omitted → runs nightly sweep for ALL active nurses.
 *
 * Returns:
 *   { success: true, result: ComplianceGuardianResult }
 *   OR
 *   { success: true, sweep: NightlySweepSummary }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase-server'
import { AgentRunner } from '@/agents/core/AgentRunner'
import { ComplianceGuardian, runNightlyComplianceSweep } from '@/agents/ComplianceGuardian'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // ── Auth: CRON_SECRET or admin session ─────────────────────────────────────
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  let authorized = false

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    authorized = true
  }

  if (!authorized) {
    const supabase = await createSupabaseServerClient()
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createSupabaseAdminClient()
    const { data: profile } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .maybeSingle()

    if (profile?.role !== 'super_admin' && profile?.role !== 'hospital_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    authorized = true
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: { nurseId?: string; facilityId?: string; mode?: string } = {}
  try {
    body = await req.json()
  } catch {
    // Empty body is valid — defaults to nightly sweep
  }

  const mode = (body.mode ?? 'nightly') as 'nightly' | 'shift_booking' | 'onboarding'

  // ── Nightly sweep (no nurseId → all nurses) ────────────────────────────────
  if (!body.nurseId) {
    try {
      const sweep = await runNightlyComplianceSweep()
      return NextResponse.json({ success: true, sweep }, { status: 200 })
    } catch (err) {
      console.error('[API/compliance-guardian] Sweep error:', (err as Error).message)
      return NextResponse.json({ error: 'Sweep failed', detail: (err as Error).message }, { status: 500 })
    }
  }

  // ── Single nurse run ───────────────────────────────────────────────────────
  const runner = new AgentRunner()
  runner.register(new ComplianceGuardian())

  const output = await runner.run({
    agentName: 'ComplianceGuardian',
    mode,
    nurseId: body.nurseId,
    facilityId: body.facilityId,
  })

  if (!output.success) {
    return NextResponse.json(
      { error: 'Agent run failed', detail: output.error },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true, result: output.result }, { status: 200 })
}
