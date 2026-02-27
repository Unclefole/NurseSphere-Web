/**
 * GET  /api/team/members — list all admins for the authenticated facility
 * DELETE /api/team/members — remove an admin (cannot remove self)
 * Body for DELETE: { profile_id: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabase
      .from('facility_admins')
      .select(`
        profile_id,
        role,
        created_at,
        profiles:profile_id (
          id,
          full_name,
          email,
          avatar_url
        )
      `)
      .eq('facility_id', auth.hospitalId)
      .order('created_at', { ascending: true })

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json({ members: [] })
      }
      throw error
    }

    const members = (data ?? []).map((row: Record<string, unknown>) => {
      const profile = row.profiles as Record<string, string | null> | null
      return {
        profile_id: row.profile_id,
        role: row.role,
        joined_at: row.created_at,
        full_name: profile?.full_name ?? null,
        email: profile?.email ?? null,
        avatar_url: profile?.avatar_url ?? null,
      }
    })

    return NextResponse.json({ members })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[TeamMembers GET] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: { profile_id: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    if (!body.profile_id) {
      return NextResponse.json({ error: 'profile_id is required' }, { status: 400 })
    }

    // Prevent self-removal
    if (body.profile_id === auth.userId) {
      return NextResponse.json({ error: 'You cannot remove yourself from the facility' }, { status: 400 })
    }

    const adminSupabase = createSupabaseAdminClient()

    const { error: deleteErr } = await adminSupabase
      .from('facility_admins')
      .delete()
      .eq('profile_id', body.profile_id)
      .eq('facility_id', auth.hospitalId)

    if (deleteErr) {
      throw new Error(`Failed to remove admin: ${deleteErr.message}`)
    }

    // Audit
    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: auth.userId,
      facility_id: auth.hospitalId,
      action: 'team.member.removed',
      target_id: body.profile_id,
      target_type: 'profile',
      metadata: { removed_profile_id: body.profile_id },
      ip_address,
    })

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[TeamMembers DELETE] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
