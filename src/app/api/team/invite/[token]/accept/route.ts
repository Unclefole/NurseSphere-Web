/**
 * POST /api/team/invite/[token]/accept
 *
 * Authenticated user. Accepts an admin invite.
 * Validates token, adds user to facility_admins, updates profile role.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'

interface RouteContext {
  params: Promise<{ token: string }>
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { token } = await context.params

  try {
    const supabase = await createSupabaseServerClient()

    // Authenticate
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createSupabaseAdminClient() as any

    // Fetch and validate invite
    const { data: inviteRaw, error: inviteErr } = await db
      .from('admin_invites')
      .select('id, facility_id, email, role, status, expires_at, invited_by')
      .eq('token', token)
      .single()

    if (inviteErr || !inviteRaw) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    const invite = inviteRaw as Record<string, unknown>

    if (invite.status !== 'pending') {
      return NextResponse.json(
        { error: `This invitation has already been ${invite.status}` },
        { status: 410 }
      )
    }

    if (new Date(invite.expires_at as string) < new Date()) {
      await db.from('admin_invites').update({ status: 'expired' }).eq('token', token)
      return NextResponse.json({ error: 'This invitation has expired' }, { status: 410 })
    }

    // Validate email matches authenticated user
    const inviteEmail = (invite.email as string).toLowerCase()
    const userEmail = (user.email ?? '').toLowerCase()
    if (inviteEmail !== userEmail) {
      return NextResponse.json(
        { error: `This invitation was sent to ${invite.email}. Please sign in with that account.` },
        { status: 403 }
      )
    }

    const facilityId = invite.facility_id as string
    const role = invite.role as string
    const now = new Date().toISOString()

    // Check if user is already a facility admin
    const { data: existingAdmin } = await db
      .from('facility_admins')
      .select('profile_id')
      .eq('profile_id', user.id)
      .eq('facility_id', facilityId)
      .maybeSingle()

    if (!existingAdmin) {
      // Add to facility_admins
      const { error: faError } = await db.from('facility_admins').insert({
        profile_id: user.id,
        facility_id: facilityId,
        role,
        created_at: now,
      })

      if (faError) {
        throw new Error(`Failed to add facility admin: ${faError.message}`)
      }
    }

    // Update profile role
    await db
      .from('profiles')
      .update({ role: 'hospital_admin' })
      .eq('id', user.id)

    // Mark invite as accepted
    const { error: acceptErr } = await db
      .from('admin_invites')
      .update({
        status: 'accepted',
        accepted_at: now,
        accepted_by: user.id,
      })
      .eq('token', token)

    if (acceptErr) {
      throw new Error(`Failed to mark invite accepted: ${acceptErr.message}`)
    }

    // Audit
    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: user.id,
      facility_id: facilityId,
      action: 'team.invite.accepted',
      target_id: invite.id as string,
      target_type: 'admin_invite',
      metadata: { email: invite.email, role, invited_by: invite.invited_by },
      ip_address,
    })

    return NextResponse.json({ success: true, facility_id: facilityId })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[InviteAccept POST] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
