/**
 * Nightly Compliance Sweep
 * Server-side only — uses service role client.
 *
 * For each facility:
 *   1. Fetch all active nurse assignments (via contracts or shifts)
 *   2. Fetch each nurse's credentials
 *   3. Compute compliance score
 *   4. Generate / upsert compliance alerts
 *   5. Persist scores to compliance_scores table
 *   6. Escalation ladder: 30-day / 7-day / expired notifications (deduplicated)
 *   7. Audit-log the sweep and every notification trigger
 *
 * HIPAA: No PHI in logs. Audit logs written server-side only.
 */

import { createClient } from '@supabase/supabase-js'
import { computeComplianceScore } from './score-engine'
import { generateAlerts } from './alert-generator'
import type { Credential } from './types'
import { writeAuditLog } from '@/lib/audit'
import { createRenewalTask } from '@/lib/credentials/renewal-flow'
import { notifyCredentialExpiring } from '@/lib/notifications/notification-service'
import { createInAppNotification } from '@/lib/notifications/in-app-notifications'

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role env vars')
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export interface SweepSummary {
  facilities_processed: number
  nurses_scored: number
  alerts_generated: number
  renewal_tasks_created: number
  notifications_sent: number
  errors: string[]
  swept_at: string
}

// ─── Escalation Helpers ───────────────────────────────────────────────────────

/**
 * Check if a compliance_alert of a given type already exists (open) for this
 * nurse+facility+credential combination. Prevents duplicate notifications
 * within the same escalation level on repeated sweep runs.
 */
async function hasOpenAlert(
  supabase: ReturnType<typeof createAdminClient>,
  nurseId: string,
  facilityId: string,
  credentialId: string,
  alertType: 'expiring_30' | 'expiring_7' | 'expired'
): Promise<boolean> {
  const { data, error } = await supabase
    .from('compliance_alerts')
    .select('id')
    .eq('nurse_id', nurseId)
    .eq('facility_id', facilityId)
    .eq('credential_id', credentialId)
    .eq('alert_type', alertType)
    .eq('status', 'open')
    .limit(1)
    .maybeSingle()

  if (error) return false
  return !!data
}

/**
 * Fire the full escalation ladder for a single credential.
 *
 * Levels:
 *   Day 30: expiring_30 — email + in-app (medium severity)
 *   Day 7:  expiring_7  — email + in-app (high severity), escalation of expiring_30
 *   Day 0:  expired     — email + in-app (critical severity) + auto-create renewal task
 *
 * Deduplication: checks compliance_alerts for an existing open alert at that level.
 * If one already exists the notification was already sent in a previous sweep;
 * skip to avoid spamming the nurse.
 */
async function runEscalationForCredential(
  supabase: ReturnType<typeof createAdminClient>,
  nurseId: string,
  facilityId: string,
  cred: Credential,
  daysUntilExpiry: number,
  summary: SweepSummary
): Promise<void> {
  const credentialType = cred.type ?? 'Credential'

  // Determine which escalation level applies
  let alertType: 'expiring_30' | 'expiring_7' | 'expired'
  let severity: 'medium' | 'high' | 'critical'

  if (daysUntilExpiry <= 0) {
    alertType = 'expired'
    severity = 'critical'
  } else if (daysUntilExpiry <= 7) {
    alertType = 'expiring_7'
    severity = 'high'
  } else if (daysUntilExpiry <= 30) {
    alertType = 'expiring_30'
    severity = 'medium'
  } else {
    return // not yet in escalation window
  }

  // Deduplication: don't re-send if we already have an open alert at this level
  const alreadyAlerted = await hasOpenAlert(supabase, nurseId, facilityId, cred.id, alertType)
  if (alreadyAlerted) {
    return // already notified at this level
  }

  // ── Send email + in-app via notification service ──────────────────────────
  // notifyCredentialExpiring handles email + in-app + audit log internally
  await notifyCredentialExpiring(nurseId, cred.id, Math.max(0, daysUntilExpiry), facilityId)
  summary.notifications_sent++

  // ── For expired: auto-create renewal task if none exists ──────────────────
  if (alertType === 'expired') {
    try {
      const task = await createRenewalTask(nurseId, cred.id, facilityId)
      if (task) {
        summary.renewal_tasks_created++
      }
    } catch (taskErr) {
      summary.errors.push(`Renewal task error [cred=${cred.id}]: ${String(taskErr)}`)
    }
  }

  // ── Audit log this escalation event ──────────────────────────────────────
  await writeAuditLog({
    actor_id: 'system',
    facility_id: facilityId,
    action: 'notification.credential_expiring_sent',
    target_id: nurseId,
    target_type: 'profile',
    metadata: {
      credential_id: cred.id,
      credential_type: credentialType,
      days_until_expiry: daysUntilExpiry,
      escalation_level: alertType,
      severity,
      channels: ['email', 'in_app'],
    },
    ip_address: null,
  })
}

// ─── nightlyComplianceSweep ───────────────────────────────────────────────────

/**
 * nightlyComplianceSweep
 *
 * Runs a full compliance sweep across all facilities and their nurses.
 * Safe to call from a cron endpoint (idempotent — upserts not inserts).
 */
export async function nightlyComplianceSweep(): Promise<SweepSummary> {
  const supabase = createAdminClient()
  const summary: SweepSummary = {
    facilities_processed: 0,
    nurses_scored: 0,
    alerts_generated: 0,
    renewal_tasks_created: 0,
    notifications_sent: 0,
    errors: [],
    swept_at: new Date().toISOString(),
  }

  // 1. Get all facilities
  const { data: facilities, error: facError } = await supabase
    .from('facilities')
    .select('id')

  if (facError || !facilities) {
    summary.errors.push(`Failed to fetch facilities: ${facError?.message}`)
    return summary
  }

  for (const facility of facilities) {
    try {
      // 2. Get unique nurse IDs active at this facility via contracts
      const { data: contracts } = await supabase
        .from('contracts')
        .select('nurse_id')
        .eq('facility_id', facility.id)

      // Also pull from shifts
      const { data: shifts } = await supabase
        .from('shifts')
        .select('nurse_id')
        .eq('facility_id', facility.id)

      const nurseSet = new Set<string>()
      for (const c of contracts ?? []) nurseSet.add(c.nurse_id)
      for (const s of shifts ?? []) if (s.nurse_id) nurseSet.add(s.nurse_id)

      const nurseIds = Array.from(nurseSet)

      for (const nurseId of nurseIds) {
        try {
          // 3. Fetch credentials for this nurse + facility
          const { data: rawCreds } = await supabase
            .from('credentials')
            .select('id, nurse_id, facility_id, type, issuing_state, number, status, expiration_date, verified_at, verified_by, source, created_at, updated_at')
            .eq('nurse_id', nurseId)
            .eq('facility_id', facility.id)

          const credentials = (rawCreds ?? []) as Credential[]

          // 4. Compute compliance score
          const scoreResult = computeComplianceScore(nurseId, facility.id, credentials)

          // 5. Persist score (upsert)
          await supabase.from('compliance_scores').upsert(
            {
              facility_id: facility.id,
              nurse_id: nurseId,
              score: scoreResult.score,
              reasons: scoreResult.reasons,
              computed_at: scoreResult.computed_at,
            },
            { onConflict: 'facility_id,nurse_id' }
          )

          // 6. Generate / upsert compliance alerts
          const alerts = await generateAlerts(nurseId, facility.id, credentials)
          summary.alerts_generated += alerts.length
          summary.nurses_scored++

          // 7. Escalation ladder: notify for each credential in the warning window
          //    Levels: 30-day → 7-day → expired
          //    Each level deduplicates via compliance_alerts (open status check)
          for (const cred of credentials) {
            if (!cred.expiration_date) continue

            const exp = new Date(cred.expiration_date)
            const now = new Date()
            now.setHours(0, 0, 0, 0)
            exp.setHours(0, 0, 0, 0)
            const daysUntilExpiry = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

            // Only run escalation if within 30-day window (or already expired)
            if (daysUntilExpiry <= 30) {
              await runEscalationForCredential(
                supabase,
                nurseId,
                facility.id,
                cred,
                daysUntilExpiry,
                summary
              )
            }
          }
        } catch (nurseErr) {
          // Non-fatal: continue with next nurse
          summary.errors.push(
            `Nurse sweep error [facility=${facility.id}]: ${String(nurseErr)}`
          )
        }
      }

      summary.facilities_processed++
    } catch (facErr) {
      summary.errors.push(`Facility sweep error [${facility.id}]: ${String(facErr)}`)
    }
  }

  // 8. Audit log the sweep (server-side, no PHI)
  await writeAuditLog({
    actor_id: 'system',
    action: 'compliance.nightly_sweep',
    target_type: 'compliance_scores',
    target_id: null,
    metadata: {
      facilities_processed: summary.facilities_processed,
      nurses_scored: summary.nurses_scored,
      alerts_generated: summary.alerts_generated,
      renewal_tasks_created: summary.renewal_tasks_created,
      notifications_sent: summary.notifications_sent,
      error_count: summary.errors.length,
      swept_at: summary.swept_at,
    },
  })

  return summary
}
