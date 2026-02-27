/**
 * Fraud Check API
 * POST /api/fraud/check — run fraud checks for a user (called on login/registration)
 * Body: { userId, email?, phone?, ip?, region?, facilityId? }
 * Returns: { events_created: number, risk_level: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { runFraudChecks, computeRiskLevel } from '@/lib/fraud/detectors'
import { extractRequestMeta } from '@/lib/audit'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    userId?: string
    email?: string
    phone?: string
    ip?: string
    region?: string
    facilityId?: string
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { userId, email, phone, facilityId } = body

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  }

  // Extract IP from request headers (override if caller passed one)
  const { ip_address } = extractRequestMeta(request)
  const ip = body.ip ?? ip_address ?? undefined
  const region = body.region ?? undefined

  try {
    const events = await runFraudChecks(userId, {
      email,
      phone,
      ip,
      region,
      facilityId,
    })

    const risk_level = computeRiskLevel(events)

    return NextResponse.json({
      events_created: events.length,
      risk_level,
      event_ids: events.map((e) => e.id),
    })
  } catch (err) {
    console.error('[fraud/check] Error running checks:', err)
    return NextResponse.json({ error: 'Fraud check failed' }, { status: 500 })
  }
}
