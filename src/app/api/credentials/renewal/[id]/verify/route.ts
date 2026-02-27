/**
 * Renewal Verification API
 * POST /api/credentials/renewal/[id]/verify
 * Admin verifies a submitted renewal task → activates the credential.
 * Body: { notes?: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase-server'
import { verifyRenewal } from '@/lib/credentials/renewal-flow'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'

export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify admin has facility access
  const { data: facilityAdminRaw } = await supabase
    .from('facility_admins')
    .select('facility_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  const facilityAdmin = facilityAdminRaw as { facility_id: string } | null

  if (!facilityAdmin) {
    // Check if super-admin via profile role
    const { data: profileRaw } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const profile = profileRaw as { role: string } | null
    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden — admin access required' }, { status: 403 })
    }
  }

  // Validate the task belongs to the admin's facility
  if (facilityAdmin) {
    const adminClient = createSupabaseAdminClient()
    const { data: taskRaw } = await adminClient
      .from('renewal_tasks')
      .select('facility_id')
      .eq('id', id)
      .single()

    const task = taskRaw as { facility_id: string | null } | null
    if (task?.facility_id && task.facility_id !== facilityAdmin.facility_id) {
      return NextResponse.json({ error: 'Forbidden — not your facility' }, { status: 403 })
    }
  }

  let body: { notes?: string } = {}
  try {
    body = await request.json()
  } catch {
    // notes are optional
  }

  // Add notes if provided
  if (body.notes) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminClient = createSupabaseAdminClient() as any
    await adminClient
      .from('renewal_tasks')
      .update({ notes: body.notes })
      .eq('id', id)
  }

  const { task, credentialUpdated } = await verifyRenewal(id, user.id)

  if (!task) {
    return NextResponse.json({ error: 'Failed to verify renewal task' }, { status: 500 })
  }

  const { ip_address } = extractRequestMeta(request)
  await writeAuditLog({
    actor_id: user.id,
    action: 'renewal_task_verified',
    target_type: 'renewal_tasks',
    target_id: id,
    metadata: { credential_id: task.credential_id, credential_activated: credentialUpdated },
    ip_address,
  })

  return NextResponse.json({ task, credential_updated: credentialUpdated })
}
