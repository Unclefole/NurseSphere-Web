/**
 * POST /api/team/invite
 *
 * Admin only. Creates an invite for a colleague to co-manage the facility.
 * Sends an invitation email via SendGrid (if configured).
 * Body: { email: string, role?: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'

interface InviteBody {
  email: string
  role?: string
}

async function sendInviteEmail(params: {
  toEmail: string
  facilityName: string
  inviterName: string
  inviteLink: string
  role: string
}): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY
  if (!apiKey) {
    console.warn('[InviteEmail] SENDGRID_API_KEY not set — skipping email send')
    return
  }

  const fromEmail = process.env.SENDGRID_FROM_EMAIL ?? 'noreply@nursesphere.app'

  const body = {
    personalizations: [
      {
        to: [{ email: params.toEmail }],
        subject: `You've been invited to manage ${params.facilityName} on NurseSphere`,
      },
    ],
    from: { email: fromEmail, name: 'NurseSphere' },
    content: [
      {
        type: 'text/html',
        value: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #6366f1; padding: 24px; border-radius: 8px 8px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 24px;">NurseSphere</h1>
            </div>
            <div style="padding: 32px; background: #f9fafb; border-radius: 0 0 8px 8px;">
              <h2 style="color: #1a1a2e;">You've been invited!</h2>
              <p style="color: #4b5563; font-size: 16px;">
                <strong>${params.inviterName}</strong> has invited you to co-manage
                <strong>${params.facilityName}</strong> on NurseSphere as a <strong>${params.role}</strong>.
              </p>
              <p style="color: #4b5563; font-size: 16px;">
                Click the button below to accept your invitation. This link expires in 7 days.
              </p>
              <div style="text-align: center; margin: 32px 0;">
                <a href="${params.inviteLink}"
                   style="background: #6366f1; color: white; padding: 14px 28px; border-radius: 8px;
                          text-decoration: none; font-size: 16px; font-weight: bold;">
                  Accept Invitation
                </a>
              </div>
              <p style="color: #9ca3af; font-size: 13px;">
                If you didn't expect this invitation, you can safely ignore this email.
              </p>
            </div>
          </div>
        `,
      },
    ],
  }

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const txt = await res.text()
    console.error('[InviteEmail] SendGrid error:', res.status, txt)
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: InviteBody
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    if (!body.email || typeof body.email !== 'string') {
      return NextResponse.json({ error: 'email is required' }, { status: 400 })
    }

    const email = body.email.toLowerCase().trim()
    const role = body.role ?? 'hospital_admin'

    // Use admin client to insert (bypasses RLS for token generation)
    const adminSupabase = createSupabaseAdminClient()

    // Check for existing pending invite for this email+facility
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingRaw } = await (adminSupabase as any)
      .from('admin_invites')
      .select('id, status')
      .eq('facility_id', auth.hospitalId)
      .eq('email', email)
      .eq('status', 'pending')
      .maybeSingle()

    if (existingRaw) {
      return NextResponse.json(
        { error: 'A pending invitation already exists for this email address' },
        { status: 409 }
      )
    }

    // Fetch facility name and inviter name for the email
    const [facilityResult, inviterResult] = await Promise.all([
      adminSupabase.from('facilities').select('name').eq('id', auth.hospitalId).single(),
      adminSupabase.from('profiles').select('full_name').eq('id', auth.userId).single(),
    ])

    const facilityName = (facilityResult.data as Record<string, string> | null)?.name ?? 'your facility'
    const inviterName = (inviterResult.data as Record<string, string | null> | null)?.full_name ?? 'A team member'

    // Create the invite
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inviteRaw, error: insertErr } = await (adminSupabase as any)
      .from('admin_invites')
      .insert({
        facility_id: auth.hospitalId,
        invited_by: auth.userId,
        email,
        role,
      })
      .select('id, token')
      .single()

    if (insertErr || !inviteRaw) {
      throw new Error(`Failed to create invite: ${insertErr?.message}`)
    }

    const invite = inviteRaw as Record<string, string>

    // Build invite link
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? 'https://nursesphere.app'
    const inviteLink = `${baseUrl}/invite/${invite.token}`

    // Send email (non-blocking — don't fail the request if email fails)
    sendInviteEmail({ toEmail: email, facilityName, inviterName, inviteLink, role }).catch(
      (e) => console.error('[InviteEmail] Failed:', e)
    )

    // Audit
    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: auth.userId,
      facility_id: auth.hospitalId,
      action: 'team.invite.created',
      target_id: invite.id,
      target_type: 'admin_invite',
      metadata: { email, role, invite_id: invite.id },
      ip_address,
    })

    return NextResponse.json(
      {
        invite_id: invite.id,
        email,
        role,
        invite_link: inviteLink,
      },
      { status: 201 }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Invite POST] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
