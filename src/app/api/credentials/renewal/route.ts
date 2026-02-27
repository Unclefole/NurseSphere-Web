/**
 * Credential Renewal API
 * POST /api/credentials/renewal — create a renewal task for a credential
 * GET  /api/credentials/renewal — list renewal tasks (nurse: own; admin: facility)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase-server'
import { createRenewalTask } from '@/lib/credentials/renewal-flow'

export const runtime = 'nodejs'

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { credential_id?: string; facility_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { credential_id, facility_id } = body

  if (!credential_id) {
    return NextResponse.json({ error: 'credential_id is required' }, { status: 400 })
  }

  const task = await createRenewalTask(user.id, credential_id, facility_id)

  if (!task) {
    return NextResponse.json({ error: 'Failed to create renewal task' }, { status: 500 })
  }

  return NextResponse.json({ task }, { status: 201 })
}

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
  const statusFilter = searchParams.get('status')
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const pageSize = 25

  const admin = createSupabaseAdminClient()

  // Check if user is a facility admin
  const { data: facilityAdminRaw } = await supabase
    .from('facility_admins')
    .select('facility_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  const facilityAdmin = facilityAdminRaw as { facility_id: string } | null

  let query = admin
    .from('renewal_tasks')
    .select(
      `
      id, nurse_id, credential_id, facility_id, status, steps,
      new_document_url, submitted_at, verified_at, verified_by, notes,
      created_at, updated_at,
      nurse:profiles!nurse_id(id, full_name),
      credential:credentials!credential_id(id, type, expiration_date, status)
    `,
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1)

  if (facilityAdmin) {
    // Admin: show tasks for their facility
    query = query.eq('facility_id', facilityAdmin.facility_id)
  } else {
    // Nurse: show own tasks
    query = query.eq('nurse_id', user.id)
  }

  if (statusFilter) query = query.eq('status', statusFilter)

  const { data, error, count } = await query

  if (error) {
    console.error('[credentials/renewal] GET error:', error.message)
    return NextResponse.json({ error: 'Failed to fetch renewal tasks' }, { status: 500 })
  }

  return NextResponse.json({ tasks: data ?? [], total: count ?? 0, page, pageSize })
}
