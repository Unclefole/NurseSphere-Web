/**
 * POST /api/notifications/test
 *
 * Sends a test email to the authenticated admin.
 * Admin only. Returns masked email address.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { sendEmail } from '@/lib/notifications/email'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized — admin access required' }, { status: 401 })
    }

    const email = auth.email
    if (!email) {
      return NextResponse.json({ error: 'No email found for authenticated user' }, { status: 422 })
    }

    await sendEmail({
      to: email,
      subject: 'NurseSphere — Test Notification',
      htmlBody: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
  <div style="background: #0ea5e9; padding: 24px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0;">NurseSphere</h1>
    <p style="color: #bae6fd; margin: 4px 0 0;">Test Notification</p>
  </div>
  <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
    <p>This is a test notification from NurseSphere.</p>
    <p>If you received this, your email delivery is working correctly.</p>
    <p style="color: #94a3b8; font-size: 12px;">Sent at: ${new Date().toISOString()}</p>
  </div>
</body>
</html>`,
      textBody: `NurseSphere Test Notification\n\nThis is a test. Email delivery is working.\n\nSent at: ${new Date().toISOString()}`,
    })

    // Mask email: show first 2 chars + domain
    const [localPart, domain] = email.split('@')
    const maskedEmail = `${localPart.slice(0, 2)}***@${domain}`

    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: auth.userId,
      action: 'notification.test_sent',
      target_type: 'email',
      target_id: auth.userId,
      facility_id: auth.hospitalId,
      metadata: {
        // HIPAA: no actual email address in audit log
        masked_to: maskedEmail,
      },
      ip_address,
    })

    return NextResponse.json({ sent: true, to: maskedEmail })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[NotificationTest] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
