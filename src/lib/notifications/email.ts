/**
 * SendGrid Email Delivery — NurseSphere
 * Server-side ONLY. Never import from client components.
 *
 * HIPAA: Never log email content. Only log error IDs to audit_logs.
 * Env vars required:
 *   SENDGRID_API_KEY     — Bearer token for SendGrid API
 *   SENDGRID_FROM_EMAIL  — Sender address (e.g., noreply@nursesphere.io)
 */

import { writeAuditLog } from '@/lib/audit'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailContent {
  subject: string
  html: string
  text: string
}

export interface SendEmailOptions {
  to: string
  subject: string
  htmlBody: string
  textBody: string
}

// ─── Core Send Function ───────────────────────────────────────────────────────

/**
 * sendEmail
 *
 * Sends an email via SendGrid REST API using fetch().
 * Gracefully degrades on failure — never throws.
 * Never logs email content (PHI risk).
 */
export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY
  const fromEmail = process.env.SENDGRID_FROM_EMAIL ?? 'noreply@nursesphere.io'

  if (!apiKey) {
    console.warn('[Email] SENDGRID_API_KEY not set — email skipped')
    return
  }

  const payload = {
    personalizations: [
      {
        to: [{ email: opts.to }],
      },
    ],
    from: { email: fromEmail, name: 'NurseSphere' },
    subject: opts.subject,
    content: [
      { type: 'text/plain', value: opts.textBody },
      { type: 'text/html', value: opts.htmlBody },
    ],
  }

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorId = `sg-err-${Date.now()}`
      // Log error ID only — never log recipient email or subject (PHI risk)
      console.error(`[Email] SendGrid error [${errorId}] status=${response.status}`)

      // Audit log error ID only, no content
      await writeAuditLog({
        actor_id: null,
        action: 'notification.email.send_failed',
        target_id: errorId,
        target_type: 'email',
        metadata: {
          error_id: errorId,
          http_status: response.status,
          // HIPAA: no recipient, subject, or body logged
        },
      }).catch(() => {
        // Double-safe: swallow audit log failures too
      })
    }
  } catch (err) {
    const errorId = `sg-exc-${Date.now()}`
    console.error(`[Email] Unexpected error [${errorId}]:`, err instanceof Error ? err.message : 'unknown')

    await writeAuditLog({
      actor_id: null,
      action: 'notification.email.send_exception',
      target_id: errorId,
      target_type: 'email',
      metadata: { error_id: errorId },
    }).catch(() => {})
  }
}

// ─── Email Templates ──────────────────────────────────────────────────────────

/**
 * Credential expiring notification for nurses.
 * HIPAA: nurseName is not PHI per se, but we keep templates minimal.
 */
export function credentialExpiringEmail(
  nurseName: string,
  credentialType: string,
  daysUntilExpiry: number
): EmailContent {
  const urgency = daysUntilExpiry <= 3 ? 'URGENT: ' : ''
  const subject = `${urgency}Your ${credentialType} expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}`

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1a1a2e;">
  <div style="background: #0ea5e9; padding: 24px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">NurseSphere</h1>
    <p style="color: #bae6fd; margin: 4px 0 0;">Credential Expiration Alert</p>
  </div>
  <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
    <p>Hi ${nurseName},</p>
    <p>Your <strong>${credentialType}</strong> credential is expiring in <strong>${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}</strong>.</p>
    <p>To avoid interruption to your shifts, please renew your credential as soon as possible.</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://nursesphere.app'}/credentials"
         style="background: #0ea5e9; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600;">
        Renew Credential
      </a>
    </div>
    <p style="color: #64748b; font-size: 14px;">
      If you've already renewed, please upload your new documentation to NurseSphere.
    </p>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
    <p style="color: #94a3b8; font-size: 12px;">
      NurseSphere &mdash; Healthcare Staffing Platform<br>
      This is an automated compliance reminder.
    </p>
  </div>
</body>
</html>`

  const text = `Hi ${nurseName},

Your ${credentialType} credential expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}.

Please renew it at: ${process.env.NEXT_PUBLIC_APP_URL ?? 'https://nursesphere.app'}/credentials

-- NurseSphere Compliance`

  return { subject, html, text }
}

/**
 * High-risk shift fill alert for facility admins.
 */
export function shiftFillAlertEmail(
  adminName: string,
  facilityName: string,
  shiftDate: string,
  fillProbability: number
): EmailContent {
  const pct = Math.round(fillProbability * 100)
  const subject = `⚠️ Low Fill Risk: ${facilityName} shift on ${shiftDate} (${pct}% fill probability)`

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1a1a2e;">
  <div style="background: #ef4444; padding: 24px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">NurseSphere</h1>
    <p style="color: #fecaca; margin: 4px 0 0;">Shift Fill Alert</p>
  </div>
  <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
    <p>Hi ${adminName},</p>
    <p>A shift at <strong>${facilityName}</strong> on <strong>${shiftDate}</strong> has a low fill probability of <strong>${pct}%</strong>.</p>
    <p>Immediate action is recommended to ensure coverage.</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://nursesphere.app'}/dashboard/shifts"
         style="background: #ef4444; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600;">
        Review Shift
      </a>
    </div>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
    <p style="color: #94a3b8; font-size: 12px;">NurseSphere &mdash; Healthcare Staffing Platform</p>
  </div>
</body>
</html>`

  const text = `Hi ${adminName},

A shift at ${facilityName} on ${shiftDate} has a low fill probability of ${pct}%.

Please review and take action: ${process.env.NEXT_PUBLIC_APP_URL ?? 'https://nursesphere.app'}/dashboard/shifts

-- NurseSphere`

  return { subject, html, text }
}

/**
 * Welcome email for new nurses.
 */
export function welcomeNurseEmail(nurseName: string): EmailContent {
  const subject = 'Welcome to NurseSphere — Your Nursing Career Starts Here'

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1a1a2e;">
  <div style="background: #0ea5e9; padding: 24px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Welcome to NurseSphere 🎉</h1>
  </div>
  <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
    <p>Hi ${nurseName},</p>
    <p>Welcome to <strong>NurseSphere</strong>! We're excited to help you find the best nursing opportunities.</p>
    <p>Here's how to get started:</p>
    <ol>
      <li>Complete your profile</li>
      <li>Upload your credentials</li>
      <li>Browse available shifts</li>
      <li>Apply and start earning</li>
    </ol>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://nursesphere.app'}/onboarding"
         style="background: #0ea5e9; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600;">
        Complete Your Profile
      </a>
    </div>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
    <p style="color: #94a3b8; font-size: 12px;">NurseSphere &mdash; Healthcare Staffing Platform</p>
  </div>
</body>
</html>`

  const text = `Hi ${nurseName},

Welcome to NurseSphere! Get started at: ${process.env.NEXT_PUBLIC_APP_URL ?? 'https://nursesphere.app'}/onboarding

-- The NurseSphere Team`

  return { subject, html, text }
}

/**
 * Welcome email for new facility administrators.
 */
export function welcomeAdminEmail(adminName: string, facilityName: string): EmailContent {
  const subject = `Welcome to NurseSphere — ${facilityName} is ready`

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1a1a2e;">
  <div style="background: #0ea5e9; padding: 24px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Welcome to NurseSphere 🏥</h1>
  </div>
  <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
    <p>Hi ${adminName},</p>
    <p>Your facility <strong>${facilityName}</strong> has been set up on <strong>NurseSphere</strong>.</p>
    <p>You can now:</p>
    <ul>
      <li>Post open shifts and find qualified nurses</li>
      <li>Manage compliance and credentials</li>
      <li>Review and approve timecards</li>
      <li>Track invoices and billing</li>
    </ul>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://nursesphere.app'}/dashboard"
         style="background: #0ea5e9; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600;">
        Go to Dashboard
      </a>
    </div>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
    <p style="color: #94a3b8; font-size: 12px;">NurseSphere &mdash; Healthcare Staffing Platform</p>
  </div>
</body>
</html>`

  const text = `Hi ${adminName},

${facilityName} is set up on NurseSphere. Access your dashboard at: ${process.env.NEXT_PUBLIC_APP_URL ?? 'https://nursesphere.app'}/dashboard

-- The NurseSphere Team`

  return { subject, html, text }
}

/**
 * Invoice created notification for facility admins.
 */
export function invoiceCreatedEmail(
  adminName: string,
  amount: number,
  shiftDate: string
): EmailContent {
  const formattedAmount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)

  const subject = `Invoice Created — ${formattedAmount} for shift on ${shiftDate}`

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1a1a2e;">
  <div style="background: #0ea5e9; padding: 24px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">NurseSphere</h1>
    <p style="color: #bae6fd; margin: 4px 0 0;">New Invoice</p>
  </div>
  <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
    <p>Hi ${adminName},</p>
    <p>A new invoice has been created for the shift on <strong>${shiftDate}</strong>.</p>
    <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
      <p style="margin: 0; color: #64748b; font-size: 14px;">Amount Due</p>
      <p style="margin: 4px 0 0; font-size: 32px; font-weight: 700; color: #0ea5e9;">${formattedAmount}</p>
    </div>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://nursesphere.app'}/dashboard/invoices"
         style="background: #0ea5e9; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600;">
        View Invoice
      </a>
    </div>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
    <p style="color: #94a3b8; font-size: 12px;">NurseSphere &mdash; Healthcare Staffing Platform</p>
  </div>
</body>
</html>`

  const text = `Hi ${adminName},

A new invoice of ${formattedAmount} has been created for the shift on ${shiftDate}.

View it at: ${process.env.NEXT_PUBLIC_APP_URL ?? 'https://nursesphere.app'}/dashboard/invoices

-- NurseSphere`

  return { subject, html, text }
}
