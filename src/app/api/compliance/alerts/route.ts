/**
 * GET  /api/compliance/alerts  — list alerts for the admin's facility
 * PATCH /api/compliance/alerts  — acknowledge or resolve an alert (audit-logged)
 *
 * GET params:
 *   ?status=open|acknowledged|resolved
 *   ?severity=low|medium|high|critical
 *   ?nurse_id=<uuid>
 *
 * PATCH body: { alert_id: string, action: 'acknowledge' | 'resolve' }
 */

import { NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { createClient } from '@supabase/supabase-js'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'
import type { AlertStatus } from '@/lib/compliance/types'

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient()
  const admin = await getAuthenticatedHospital(supabase)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const statusFilter = searchParams.get('status')
  const severityFilter = searchParams.get('severity')
  const nurseIdFilter = searchParams.get('nurse_id')

  const adminClient = createAdminClient()
  let query = adminClient
    .from('compliance_alerts')
    .select(
      `
      id,
      facility_id,
      nurse_id,
      credential_id,
      alert_type,
      severity,
      due_at,
      status,
      evidence,
      created_at,
      updated_at,
      profiles!compliance_alerts_nurse_id_fkey(id, full_name)
    `
    )
    .eq('facility_id', admin.hospitalId)
    .order('severity', { ascending: false })
    .order('created_at', { ascending: false })

  if (statusFilter) query = query.eq('status', statusFilter) as typeof query
  if (severityFilter) query = query.eq('severity', severityFilter) as typeof query
  if (nurseIdFilter) query = query.eq('nurse_id', nurseIdFilter) as typeof query

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ alerts: data ?? [] })
}

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient()
  const admin = await getAuthenticatedHospital(supabase)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { alert_id?: string; action?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { alert_id, action } = body
  if (!alert_id || !action) {
    return NextResponse.json({ error: 'alert_id and action are required' }, { status: 400 })
  }
  if (!['acknowledge', 'resolve'].includes(action)) {
    return NextResponse.json({ error: 'action must be acknowledge or resolve' }, { status: 400 })
  }

  const newStatus: AlertStatus = action === 'acknowledge' ? 'acknowledged' : 'resolved'
  const adminClient = createAdminClient()

  // Verify the alert belongs to this facility
  const { data: existing, error: fetchErr } = await adminClient
    .from('compliance_alerts')
    .select('id, facility_id, nurse_id, alert_type')
    .eq('id', alert_id)
    .single()

  if (fetchErr || !existing) {
    return NextResponse.json({ error: 'Alert not found' }, { status: 404 })
  }

  if (existing.facility_id !== admin.hospitalId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: updated, error: updateErr } = await adminClient
    .from('compliance_alerts')
    .update({ status: newStatus })
    .eq('id', alert_id)
    .select()
    .single()

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  const { ip_address } = extractRequestMeta(request)
  await writeAuditLog({
    actor_id: admin.userId,
    action: `compliance.alert_${action}d`,
    target_type: 'compliance_alerts',
    target_id: alert_id,
    facility_id: admin.hospitalId,
    metadata: {
      alert_type: existing.alert_type,
      nurse_id: existing.nurse_id,
      new_status: newStatus,
    },
    ip_address,
  })

  return NextResponse.json({ alert: updated })
}
