/**
 * Notification Service — NurseSphere
 * Server-side ONLY. Orchestrates email delivery for compliance and system events.
 *
 * HIPAA: Email addresses fetched via Supabase Auth Admin API — never stored in DB.
 * All actions are audit-logged. Email content is never logged.
 */

import { createClient } from '@supabase/supabase-js'
import { writeAuditLog } from '@/lib/audit'
import {
  sendEmail,
  credentialExpiringEmail,
  shiftFillAlertEmail,
  welcomeNurseEmail,
  welcomeAdminEmail,
  invoiceCreatedEmail,
} from './email'
import { createInAppNotification } from './in-app-notifications'
import { sendPushNotification, sendPushToFacilityAdmins } from './push-sender'

// ─── Admin Client ─────────────────────────────────────────────────────────────

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role env vars')
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ─── Helper: Fetch User Email from Auth Admin API ─────────────────────────────

async function getUserEmail(userId: string): Promise<string | null> {
  try {
    const supabase = getAdminClient()
    const { data, error } = await supabase.auth.admin.getUserById(userId)
    if (error || !data?.user?.email) return null
    return data.user.email
  } catch {
    return null
  }
}

// ─── Helper: Fetch Profile Name (no PHI expansion) ───────────────────────────

async function getProfileName(userId: string): Promise<string> {
  try {
    const supabase = getAdminClient()
    const { data } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data as any)?.full_name ?? 'Nurse'
  } catch {
    return 'Nurse'
  }
}

// ─── notifyCredentialExpiring ─────────────────────────────────────────────────

/**
 * Send credential expiration warning to a nurse.
 * Fetches name from profiles, email from Supabase Auth Admin API.
 */
export async function notifyCredentialExpiring(
  nurseId: string,
  credentialId: string,
  daysUntilExpiry: number,
  facilityId?: string | null
): Promise<void> {
  try {
    // Fetch nurse name from profiles (no PHI risk — names not sensitive here)
    const nurseName = await getProfileName(nurseId)

    // Fetch credential type and facility
    const supabase = getAdminClient()
    const { data: cred } = await supabase
      .from('credentials')
      .select('type, facility_id')
      .eq('id', credentialId)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const credentialType = (cred as any)?.type ?? 'Credential'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resolvedFacilityId = facilityId ?? (cred as any)?.facility_id ?? null

    const channels: string[] = []

    // ── Email notification ────────────────────────────────────────────────────
    const email = await getUserEmail(nurseId)
    if (email) {
      const { subject, html, text } = credentialExpiringEmail(nurseName, credentialType, daysUntilExpiry)
      await sendEmail({ to: email, subject, htmlBody: html, textBody: text })
      channels.push('email')
    } else {
      console.warn(`[NotificationService] No email found for nurse ${nurseId}`)
    }

    // ── In-app notification ───────────────────────────────────────────────────
    const severity = daysUntilExpiry <= 0 ? 'critical' : daysUntilExpiry <= 7 ? 'high' : 'medium'
    const title = daysUntilExpiry <= 0
      ? `${credentialType} has expired`
      : `${credentialType} expiring in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}`
    const message = daysUntilExpiry <= 0
      ? `Your ${credentialType} has expired and requires immediate renewal.`
      : `Your ${credentialType} will expire in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}. Please renew it to maintain compliance.`

    await createInAppNotification(
      nurseId,
      'credential_expiring',
      title,
      message,
      {
        credential_id: credentialId,
        credential_type: credentialType,
        days_until_expiry: daysUntilExpiry,
        severity,
      },
      resolvedFacilityId
    )
    channels.push('in_app')

    // ── Push notification ─────────────────────────────────────────────────────
    // Graceful degradation: push failure does not block email/in-app delivery
    try {
      await sendPushNotification(nurseId, {
        title: daysUntilExpiry <= 0 ? '🚨 Credential Expired' : '⚠️ Credential Expiring',
        body: message,
        data: {
          type: 'credential_expiring',
          id: credentialId,
        },
      })
      channels.push('push')
    } catch (pushErr) {
      console.warn('[NotificationService] Push failed for credential expiry (non-fatal):', pushErr)
    }

    // ── Audit log — no PHI (no email address, no PII) ─────────────────────────
    await writeAuditLog({
      actor_id: 'system',
      facility_id: resolvedFacilityId,
      action: 'notification.credential_expiring_sent',
      target_id: nurseId,
      target_type: 'profile',
      metadata: {
        credential_id: credentialId,
        credential_type: credentialType,
        days_until_expiry: daysUntilExpiry,
        channels,
        // HIPAA: no email address logged
      },
      ip_address: null,
    })
  } catch (err) {
    console.error('[NotificationService] notifyCredentialExpiring error:', err)
    // Non-fatal — swallow
  }
}

// ─── notifyShiftHighRisk ──────────────────────────────────────────────────────

/**
 * Send shift fill alert to all facility admins when a shift is high risk.
 */
export async function notifyShiftHighRisk(
  facilityId: string,
  shiftId: string,
  fillProbability: number
): Promise<void> {
  try {
    const supabase = getAdminClient()

    // Fetch facility name
    const { data: facility } = await supabase
      .from('facilities')
      .select('name')
      .eq('id', facilityId)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const facilityName = (facility as any)?.name ?? 'Your Facility'

    // Fetch shift date
    const { data: shift } = await supabase
      .from('shifts')
      .select('start_time')
      .eq('id', shiftId)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shiftDate = (shift as any)?.start_time
      ? new Date((shift as any).start_time).toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })
      : 'upcoming shift'

    // Fetch all facility admins
    const { data: admins } = await supabase
      .from('facility_admins')
      .select('profile_id')
      .eq('facility_id', facilityId)

    if (!admins || admins.length === 0) return

    for (const admin of admins) {
      try {
        const adminName = await getProfileName(admin.profile_id)
        const email = await getUserEmail(admin.profile_id)
        if (!email) continue

        const { subject, html, text } = shiftFillAlertEmail(
          adminName,
          facilityName,
          shiftDate,
          fillProbability
        )
        await sendEmail({ to: email, subject, htmlBody: html, textBody: text })
      } catch (adminErr) {
        console.error(`[NotificationService] Failed to notify admin ${admin.profile_id}:`, adminErr)
      }
    }

    // ── Push to facility admins ───────────────────────────────────────────────
    try {
      await sendPushToFacilityAdmins(facilityId, {
        title: '⚠️ Shift Fill Risk',
        body: `${facilityName}: ${shiftDate} shift has low fill probability (${Math.round(fillProbability * 100)}%).`,
        data: {
          type: 'shift_high_risk',
          id: shiftId,
        },
      })
    } catch (pushErr) {
      console.warn('[NotificationService] Push to facility admins failed (non-fatal):', pushErr)
    }

    // Audit log
    await writeAuditLog({
      actor_id: null,
      action: 'notification.shift_high_risk_sent',
      target_type: 'shift',
      target_id: shiftId,
      facility_id: facilityId,
      metadata: {
        fill_probability: fillProbability,
        admin_count: admins.length,
      },
    })
  } catch (err) {
    console.error('[NotificationService] notifyShiftHighRisk error:', err)
    // Non-fatal
  }
}

// ─── notifyWelcome ────────────────────────────────────────────────────────────

/**
 * Send appropriate welcome email based on user role.
 */
export async function notifyWelcome(userId: string, role: 'nurse' | 'admin'): Promise<void> {
  try {
    const name = await getProfileName(userId)
    const email = await getUserEmail(userId)
    if (!email) return

    if (role === 'nurse') {
      const { subject, html, text } = welcomeNurseEmail(name)
      await sendEmail({ to: email, subject, htmlBody: html, textBody: text })
    } else if (role === 'admin') {
      // Fetch facility name
      const supabase = getAdminClient()
      const { data: fa } = await supabase
        .from('facility_admins')
        .select('facility_id')
        .eq('profile_id', userId)
        .limit(1)
        .single()

      let facilityName = 'Your Facility'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((fa as any)?.facility_id) {
        const { data: fac } = await supabase
          .from('facilities')
          .select('name')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .eq('id', (fa as any).facility_id)
          .single()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        facilityName = (fac as any)?.name ?? 'Your Facility'
      }

      const { subject, html, text } = welcomeAdminEmail(name, facilityName)
      await sendEmail({ to: email, subject, htmlBody: html, textBody: text })
    }

    await writeAuditLog({
      actor_id: null,
      action: 'notification.welcome_sent',
      target_type: 'user',
      target_id: userId,
      metadata: { role },
    })
  } catch (err) {
    console.error('[NotificationService] notifyWelcome error:', err)
  }
}

// ─── notifyInvoiceCreated ─────────────────────────────────────────────────────

/**
 * Send invoice notification to facility admin(s).
 */
export async function notifyInvoiceCreated(
  facilityId: string,
  invoiceId: string,
  amount: number
): Promise<void> {
  try {
    const supabase = getAdminClient()

    // Fetch invoice metadata (shift date, if available)
    const { data: invoice } = await supabase
      .from('invoices')
      .select('created_at, shift_ids')
      .eq('id', invoiceId)
      .single()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoiceData = invoice as any
    let shiftDate = invoiceData?.created_at
      ? new Date(invoiceData.created_at).toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })
      : new Date().toLocaleDateString()

    // Fetch facility admins
    const { data: admins } = await supabase
      .from('facility_admins')
      .select('profile_id')
      .eq('facility_id', facilityId)

    if (!admins || admins.length === 0) return

    for (const admin of admins) {
      try {
        const adminName = await getProfileName(admin.profile_id)
        const email = await getUserEmail(admin.profile_id)
        if (!email) continue

        const { subject, html, text } = invoiceCreatedEmail(adminName, amount, shiftDate)
        await sendEmail({ to: email, subject, htmlBody: html, textBody: text })
      } catch (adminErr) {
        console.error(`[NotificationService] Failed to notify admin for invoice:`, adminErr)
      }
    }

    await writeAuditLog({
      actor_id: null,
      action: 'notification.invoice_created_sent',
      target_type: 'invoice',
      target_id: invoiceId,
      facility_id: facilityId,
      metadata: {
        amount,
        admin_count: admins.length,
      },
    })
  } catch (err) {
    console.error('[NotificationService] notifyInvoiceCreated error:', err)
  }
}

// ─── notifyTimecardApproved ───────────────────────────────────────────────────

/**
 * Notify a nurse (push + in-app) when their timecard has been approved.
 * Email omitted — approval is non-urgent and low-latency push suffices.
 */
export async function notifyTimecardApproved(
  nurseId: string,
  timecardId: string,
  facilityId?: string | null,
  shiftDate?: string | null
): Promise<void> {
  try {
    const channels: string[] = []
    const dateLabel = shiftDate
      ? ` for ${new Date(shiftDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      : ''

    // ── In-app ────────────────────────────────────────────────────────────────
    await createInAppNotification(
      nurseId,
      'timecard_approved',
      `✅ Timecard Approved${dateLabel}`,
      `Your timecard${dateLabel} has been approved. Check your wallet for payment status.`,
      { timecard_id: timecardId },
      facilityId ?? null
    )
    channels.push('in_app')

    // ── Push ──────────────────────────────────────────────────────────────────
    try {
      await sendPushNotification(nurseId, {
        title: `✅ Timecard Approved${dateLabel}`,
        body: `Your timecard has been approved. Check your wallet for payment status.`,
        data: {
          type: 'timecard_approved',
          id: timecardId,
        },
      })
      channels.push('push')
    } catch (pushErr) {
      console.warn('[NotificationService] Push failed for timecard approval (non-fatal):', pushErr)
    }

    await writeAuditLog({
      actor_id: 'system',
      action: 'notification.timecard_approved_sent',
      target_type: 'timecard',
      target_id: timecardId,
      facility_id: facilityId ?? null,
      metadata: { nurse_id: nurseId, channels },
    })
  } catch (err) {
    console.error('[NotificationService] notifyTimecardApproved error:', err)
  }
}
