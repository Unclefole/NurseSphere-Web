/**
 * POST /api/agents/workforce-optimization
 *
 * Runs WorkforceOptimization for a single facility or all facilities (daily sweep).
 *
 * Auth:
 *   - Bearer CRON_SECRET → cron/scheduled daily sweep
 *   - Authenticated super_admin or hospital_admin session
 *
 * Body (JSON):
 *   { facilityId?: string }
 *   If facilityId is omitted → runs daily sweep for ALL facilities.
 *
 * Returns:
 *   { success: true, result: WorkforceOptimizationResult }
 *   OR
 *   { success: true, sweep: DailySweepSummary }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase-server'
import { AgentRunner } from '@/agents/core/AgentRunner'
import { WorkforceOptimization, runDailyWorkforceOptimization } from '@/agents/WorkforceOptimization'

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
  let body: { facilityId?: string } = {}
  try {
    body = await req.json()
  } catch {
    // Empty body → sweep all facilities
  }

  // ── Full daily sweep (no facilityId) ──────────────────────────────────────
  if (!body.facilityId) {
    try {
      const sweep = await runDailyWorkforceOptimization()
      return NextResponse.json({ success: true, sweep }, { status: 200 })
    } catch (err) {
      console.error('[API/workforce-optimization] Sweep error:', (err as Error).message)
      return NextResponse.json({ error: 'Sweep failed', detail: (err as Error).message }, { status: 500 })
    }
  }

  // ── Single facility run ────────────────────────────────────────────────────
  const runner = new AgentRunner()
  runner.register(new WorkforceOptimization())

  const output = await runner.run({
    agentName: 'WorkforceOptimization',
    mode: 'daily',
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
