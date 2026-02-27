/**
 * Fraud Events API
 * GET  /api/fraud/events — list suspicious events (filtered by status, severity, facility)
 * PATCH /api/fraud/events — resolve or close an event (audit logged)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'

export const runtime = 'nodejs'

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const severity = searchParams.get('severity')
  const facilityId = searchParams.get('facility_id')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const pageSize = 25

  const admin = createSupabaseAdminClient()

  let query = admin
    .from('suspicious_events')
    .select(
      `
      id, facility_id, nurse_id, event_type, severity, evidence, status,
      resolved_by, resolved_at, created_at, updated_at,
      nurse:profiles!nurse_id(id, full_name),
      facility:facilities!facility_id(id, name)
    `,
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1)

  if (status) query = query.eq('status', status)
  if (severity) query = query.eq('severity', severity)
  if (facilityId) query = query.eq('facility_id', facilityId)
  if (from) query = query.gte('created_at', from)
  if (to) query = query.lte('created_at', to)

  const { data, error, count } = await query

  if (error) {
    console.error('[fraud/events] GET error:', error.message)
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 })
  }

  return NextResponse.json({ events: data ?? [], total: count ?? 0, page, pageSize })
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { id?: string; status?: string; action_taken?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { id, status, action_taken } = body

  if (!id || !status) {
    return NextResponse.json({ error: 'id and status are required' }, { status: 400 })
  }

  const validStatuses = ['open', 'investigating', 'closed', 'false_positive']
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createSupabaseAdminClient() as any

  const { data: updated, error: updateError } = await admin
    .from('suspicious_events')
    .update({
      status,
      resolved_by: ['closed', 'false_positive'].includes(status) ? user.id : null,
      resolved_at: ['closed', 'false_positive'].includes(status) ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (updateError) {
    console.error('[fraud/events] PATCH error:', updateError.message)
    return NextResponse.json({ error: 'Failed to update event' }, { status: 500 })
  }

  // Audit log
  const { ip_address } = extractRequestMeta(request)
  await writeAuditLog({
    actor_id: user.id,
    action: `fraud_event_${status}`,
    target_type: 'suspicious_events',
    target_id: id,
    metadata: { new_status: status, action_taken: action_taken ?? null },
    ip_address,
  })

  return NextResponse.json({ event: updated })
}
