/**
 * Compliance Sweep API
 * POST: Trigger compliance sweep (cron or super_admin)
 * GET:  Return last 10 sweep logs
 *
 * Auth:
 *   POST — Bearer token (CRON_SECRET) OR authenticated super_admin session
 *   GET  — any authenticated session
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase-server'
import { complianceSweep, getSweepHistory } from '@/lib/compliance/compliance-sweep'

// ── GET — last 10 sweep logs ───────────────────────────────────────────────────

export async function GET(_req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const history = await getSweepHistory(10)
    return NextResponse.json({ sweeps: history })
  } catch (err) {
    console.error('[API/sweep GET] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── POST — trigger sweep ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // Check Bearer token (for cron calls)
    const authHeader = req.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    let isCronAuthorized = false
    if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
      isCronAuthorized = true
    }

    if (!isCronAuthorized) {
      // Check for super_admin session
      const supabase = await createSupabaseServerClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // Check role
      const adminClient = createSupabaseAdminClient()
      const { data: profile } = await adminClient
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .maybeSingle()

      if (profile?.role !== 'super_admin') {
        return NextResponse.json({ error: 'Forbidden — super_admin required' }, { status: 403 })
      }
    }

    // Trigger sweep
    const result = await complianceSweep()

    return NextResponse.json({ success: true, result }, { status: 200 })
  } catch (err) {
    console.error('[API/sweep POST] Error:', err)
    return NextResponse.json({ error: 'Sweep failed', detail: String(err) }, { status: 500 })
  }
}
