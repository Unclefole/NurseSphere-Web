/**
 * GET /api/team/invite/[token]
 *
 * Public endpoint — no auth required.
 * Validates the invite token and returns invite details for the accept page.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

interface RouteContext {
  params: Promise<{ token: string }>
}

export async function GET(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { token } = await context.params

  try {
    if (!token || typeof token !== 'string' || token.length < 10) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
    }

    const supabase = createSupabaseAdminClient()

    // Fetch invite with joins
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inviteRaw, error } = await (supabase as any)
      .from('admin_invites')
      .select(`
        id,
        email,
        role,
        status,
        expires_at,
        facility_id,
        invited_by,
        facilities ( name ),
        profiles:invited_by ( full_name )
      `)
      .eq('token', token)
      .single()

    if (error || !inviteRaw) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    const invite = inviteRaw as Record<string, unknown>

    // Validate status
    if (invite.status !== 'pending') {
      return NextResponse.json(
        { error: `This invitation has been ${invite.status}` },
        { status: 410 }
      )
    }

    // Validate expiry
    const expiresAt = new Date(invite.expires_at as string)
    if (expiresAt < new Date()) {
      // Auto-expire
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('admin_invites')
        .update({ status: 'expired' })
        .eq('token', token)

      return NextResponse.json({ error: 'This invitation has expired' }, { status: 410 })
    }

    const facilities = invite.facilities as Record<string, string> | null
    const inviterProfile = invite.profiles as Record<string, string | null> | null

    return NextResponse.json({
      invite_id: invite.id,
      email: invite.email,
      role: invite.role,
      facility_id: invite.facility_id,
      facility_name: facilities?.name ?? 'Unknown Facility',
      invited_by_name: inviterProfile?.full_name ?? 'A team member',
      expires_at: invite.expires_at,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[InviteToken GET] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
