/**
 * POST /api/audit/log
 * Client-side audit log endpoint used by browser-rendered onboarding pages.
 * Validates input, then writes to the audit_logs table via the server-side writer.
 */
import { NextResponse } from 'next/server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { actor_id, action, target_type, target_id, facility_id, metadata } = body

    if (!actor_id || typeof actor_id !== 'string') {
      return NextResponse.json({ error: 'actor_id is required' }, { status: 400 })
    }
    if (!action || typeof action !== 'string') {
      return NextResponse.json({ error: 'action is required' }, { status: 400 })
    }

    const { ip_address } = extractRequestMeta(request)

    await writeAuditLog({
      actor_id,
      action,
      target_type: target_type ?? null,
      target_id: target_id ?? null,
      facility_id: facility_id ?? null,
      metadata: metadata ?? null,
      ip_address,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[AuditLog API] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
