/**
 * POST /api/team/invites/[id]/revoke
 *
 * Admin only. Revokes a pending invite.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { id: inviteId } = await context.params

  try {
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminSupabase = createSupabaseAdminClient() as any

    // Verify invite belongs to this facility
    const { data: inviteRaw, error: fetchErr } = await adminSupabase
      .from('admin_invites')
      .select('id, facility_id, email, status')
      .eq('id', inviteId)
      .single()

    if (fetchErr || !inviteRaw) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    const invite = inviteRaw as Record<string, string>

    if (invite.facility_id !== auth.hospitalId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    if (invite.status !== 'pending') {
      return NextResponse.json(
        { error: `Invite cannot be revoked (status: ${invite.status})` },
        { status: 400 }
      )
    }

    const { error: updateErr } = await adminSupabase
      .from('admin_invites')
      .update({ status: 'revoked' })
      .eq('id', inviteId)

    if (updateErr) {
      throw new Error(`Failed to revoke invite: ${updateErr.message}`)
    }

    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: auth.userId,
      facility_id: auth.hospitalId,
      action: 'team.invite.revoked',
      target_id: inviteId,
      target_type: 'admin_invite',
      metadata: { email: invite.email },
      ip_address,
    })

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[RevokeInvite] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
