/**
 * Compliance Sweep Service
 * NurseSphere TIER 1 — Continuous Compliance Engine
 *
 * Designed to run every 24h via cron (POST /api/compliance/sweep).
 *
 * For each ACTIVE nurse:
 *   1. OIG LEIE exclusion check
 *   2. NURSYS license verification (per credential)
 *   3. SAM.gov exclusion check (stub — real key needed for production)
 *   4. On failure: update credential, create alert, suspend if critical, notify admins
 *   5. Recompute compliance score
 *   6. Log sweep to compliance_sweep_log
 *   7. Audit log: action='compliance.sweep.completed'
 *
 * PHI rules:
 *   - No patient data, no nurse SSN/DOB
 *   - Names used only as function parameters to checker APIs, never stored in logs
 *   - audit_log uses actor_id UUID only
 *
 * Server-side only.
 */

import { createClient } from '@supabase/supabase-js'
import { checkOIGExclusion } from '@/lib/verification/oig-checker'
import { verifyNurseLicense } from '@/lib/verification/nursys-checker'
import { writeAuditLog } from '@/lib/audit'
import { suspendNurse, SYSTEM_UUID } from '@/lib/compliance/auto-suspension'
import { sendPushToFacilityAdmins } from '@/lib/notifications/push-sender'
import { featureFlags } from '@/lib/feature-flags'

// ── Supabase admin client ──────────────────────────────────────────────────────

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role env vars')
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SweepResult {
  sweepId: string
  nursesChecked: number
  alertsCreated: number
  suspensionsTriggered: number
  errorCount: number
  status: 'completed' | 'failed'
  startedAt: string
  completedAt: string
}

export interface SweepLog {
  id: string
  started_at: string
  completed_at: string | null
  nurses_checked: number
  alerts_created: number
  suspensions_triggered: number
  error_count: number
  status: string
  created_at: string
}

// ── SAM.gov stub ───────────────────────────────────────────────────────────────

/**
 * checkSAMExclusion
 *
 * SAM.gov (System for Award Management) exclusion check.
 * V1 stub — returns clear until SAM API key is provisioned.
 * TODO: Implement real SAM.gov API call with SAM_API_KEY env var.
 */
async function checkSAMExclusion(_nurseId: string): Promise<{ excluded: boolean; source: string }> {
  // Stub: SAM_API_KEY not yet provisioned
  // Real implementation: GET https://api.sam.gov/entity-information/v3/entities
  return { excluded: false, source: 'sam_stub' }
}

// ── Alert creation helper ──────────────────────────────────────────────────────

async function createComplianceAlert(params: {
  nurseId: string
  facilityId: string | null
  alertType: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  evidence: Record<string, unknown>
}): Promise<boolean> {
  const supabase = getAdminClient()
  const { error } = await supabase.from('compliance_alerts').insert({
    nurse_id: params.nurseId,
    facility_id: params.facilityId,
    credential_id: null,
    alert_type: params.alertType,
    severity: params.severity,
    status: 'open',
    evidence: params.evidence,
    due_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  if (error) {
    console.warn('[ComplianceSweep] Failed to create alert for nurse %s: %s', params.nurseId, error.message)
    return false
  }
  return true
}

// ── Score recompute helper ─────────────────────────────────────────────────────

async function recomputeComplianceScore(nurseId: string, facilityId: string | null): Promise<void> {
  const supabase = getAdminClient()

  // Fetch credentials for score computation
  const { data: credentials, error } = await supabase
    .from('credentials')
    .select('id, nurse_id, facility_id, type, issuing_state, number, status, expiration_date, verified_at, verified_by, source, created_at, updated_at')
    .eq('nurse_id', nurseId)

  if (error || !credentials) {
    console.warn('[ComplianceSweep] Could not fetch credentials for score recompute. nurseId=%s', nurseId)
    return
  }

  // Dynamic import to avoid circular dependency issues
  const { computeComplianceScore } = await import('@/lib/compliance/score-engine')
  const score = computeComplianceScore(nurseId, facilityId ?? '', credentials as Parameters<typeof computeComplianceScore>[2])

  // Upsert score into compliance_scores table
  await supabase.from('compliance_scores').upsert({
    nurse_id: nurseId,
    facility_id: facilityId,
    score: score.score,
    reasons: score.reasons,
    computed_at: score.computed_at,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'nurse_id,facility_id' })
}

// ── Per-nurse sweep ────────────────────────────────────────────────────────────

interface NurseRow {
  id: string
  first_name: string | null
  last_name: string | null
  facility_id: string | null
}

interface CredentialRow {
  id: string
  type: string
  number: string | null
  issuing_state: string | null
  status: string
  expiration_date: string
}

async function sweepNurse(
  nurse: NurseRow,
  credentials: CredentialRow[],
): Promise<{ alertsCreated: number; suspended: boolean; error: boolean }> {
  let alertsCreated = 0
  let suspended = false
  let error = false

  const supabase = getAdminClient()
  const facilityId = nurse.facility_id

  try {
    // 1. OIG check
    const oigResult = await checkOIGExclusion({
      firstName: nurse.first_name ?? 'Unknown',
      lastName: nurse.last_name ?? 'Unknown',
      nurseId: nurse.id,
      facilityId: facilityId ?? undefined,
    })

    if (oigResult.excluded) {
      const created = await createComplianceAlert({
        nurseId: nurse.id,
        facilityId,
        alertType: 'exclusion_hit',
        severity: 'critical',
        evidence: {
          source: oigResult.source,
          exclusion_date: oigResult.exclusion_date,
          checked_at: oigResult.checked_at,
          npi: oigResult.npi,
          // Intentionally omit: name fields
        },
      })
      if (created) alertsCreated++

      // Critical OIG hit → auto-suspend if flag enabled
      if (featureFlags.auto_suspension) {
        const suspResult = await suspendNurse(
          nurse.id,
          'OIG LEIE exclusion detected',
          { source: 'OIG_LEIE', exclusion_date: oigResult.exclusion_date, checked_at: oigResult.checked_at },
          SYSTEM_UUID,
        )
        if (suspResult.success) suspended = true
      }

      // Notify facility admins
      if (facilityId) {
        await sendPushToFacilityAdmins(facilityId, {
          title: 'Compliance Alert: OIG Exclusion',
          body: 'A nurse has been flagged on the OIG exclusion list. Immediate review required.',
          data: { type: 'compliance_alert', nurseId: nurse.id },
        }).catch(() => {}) // fire-and-forget
      }
    }

    // 2. NURSYS license check (per credential)
    for (const cred of credentials) {
      if (cred.type !== 'RN_LICENSE' && !cred.type.includes('LICENSE')) continue
      if (!cred.number || !cred.issuing_state) continue

      const nursysResult = await verifyNurseLicense({
        licenseNumber: cred.number,
        issuingState: cred.issuing_state,
        lastName: nurse.last_name ?? 'Unknown',
        nurseId: nurse.id,
        credentialId: cred.id,
        facilityId: facilityId ?? undefined,
      })

      const isLicenseInvalid =
        nursysResult.status === 'expired' ||
        nursysResult.status === 'revoked' ||
        nursysResult.status === 'surrendered'

      if (isLicenseInvalid) {
        // Update credential status in DB
        await supabase
          .from('credentials')
          .update({ status: nursysResult.status === 'active' ? 'active' : 'expired', updated_at: new Date().toISOString() })
          .eq('id', cred.id)

        const alertType = nursysResult.status === 'revoked' || nursysResult.status === 'surrendered'
          ? 'exclusion_hit'
          : 'license_invalid'

        const created = await createComplianceAlert({
          nurseId: nurse.id,
          facilityId,
          alertType,
          severity: nursysResult.status === 'revoked' || nursysResult.status === 'surrendered' ? 'critical' : 'high',
          evidence: {
            credential_id: cred.id,
            credential_type: cred.type,
            license_status: nursysResult.status,
            issuing_state: cred.issuing_state,
            checked_at: nursysResult.checked_at,
            source: 'NURSYS',
          },
        })
        if (created) alertsCreated++

        // Critical license (revoked/surrendered) → auto-suspend if flag enabled
        if (
          featureFlags.auto_suspension &&
          (nursysResult.status === 'revoked' || nursysResult.status === 'surrendered') &&
          !suspended
        ) {
          const suspResult = await suspendNurse(
            nurse.id,
            `License ${nursysResult.status} — state: ${cred.issuing_state}`,
            {
              credential_id: cred.id,
              credential_type: cred.type,
              license_status: nursysResult.status,
              issuing_state: cred.issuing_state,
              source: 'NURSYS',
            },
            SYSTEM_UUID,
          )
          if (suspResult.success) suspended = true
        }

        // Notify for non-suspension issues too
        if (facilityId) {
          await sendPushToFacilityAdmins(facilityId, {
            title: 'Compliance Alert: License Issue',
            body: `A nurse license has a status of "${nursysResult.status}". Review required.`,
            data: { type: 'compliance_alert', nurseId: nurse.id, credentialId: cred.id },
          }).catch(() => {})
        }
      }
    }

    // 3. SAM stub check
    const samResult = await checkSAMExclusion(nurse.id)
    if (samResult.excluded) {
      // If SAM were real and returned excluded, treat like OIG
      const created = await createComplianceAlert({
        nurseId: nurse.id,
        facilityId,
        alertType: 'exclusion_hit',
        severity: 'critical',
        evidence: { source: samResult.source, checked_at: new Date().toISOString() },
      })
      if (created) alertsCreated++
    }

    // 4. Recompute compliance score
    await recomputeComplianceScore(nurse.id, facilityId)

  } catch (err) {
    console.error('[ComplianceSweep] Error sweeping nurse %s: %s', nurse.id, String(err))
    error = true
  }

  return { alertsCreated, suspended, error }
}

// ── Main sweep ─────────────────────────────────────────────────────────────────

/**
 * complianceSweep
 *
 * Runs a full compliance sweep over all active nurses.
 * Designed to be called from the cron API route.
 */
export async function complianceSweep(): Promise<SweepResult> {
  const startedAt = new Date().toISOString()
  const supabase = getAdminClient()

  // Insert sweep log row (status: running)
  const { data: sweepLog, error: logError } = await supabase
    .from('compliance_sweep_log')
    .insert({
      started_at: startedAt,
      nurses_checked: 0,
      alerts_created: 0,
      suspensions_triggered: 0,
      error_count: 0,
      status: 'running',
    })
    .select('id')
    .single()

  if (logError || !sweepLog) {
    console.error('[ComplianceSweep] Failed to create sweep log row: %s', logError?.message)
    // Continue sweep even if logging fails
  }

  const sweepId = sweepLog?.id ?? 'unknown'

  let nursesChecked = 0
  let alertsCreated = 0
  let suspensionsTriggered = 0
  let errorCount = 0
  let finalStatus: 'completed' | 'failed' = 'completed'

  try {
    // Fetch all active nurses (explicit column list — no PHI like SSN)
    const { data: nurses, error: nursesError } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, facility_id')
      .eq('role', 'nurse')
      .eq('status', 'active')

    if (nursesError || !nurses) {
      throw new Error(`Failed to fetch active nurses: ${nursesError?.message}`)
    }

    // Fetch credentials for all nurses in one batch
    const nurseIds = nurses.map((n: NurseRow) => n.id)
    const { data: allCredentials } = await supabase
      .from('credentials')
      .select('id, nurse_id, type, number, issuing_state, status, expiration_date')
      .in('nurse_id', nurseIds)

    const credsByNurse = new Map<string, CredentialRow[]>()
    for (const cred of (allCredentials ?? [])) {
      if (!credsByNurse.has(cred.nurse_id)) credsByNurse.set(cred.nurse_id, [])
      credsByNurse.get(cred.nurse_id)!.push(cred)
    }

    // Sweep each nurse
    for (const nurse of nurses) {
      const creds = credsByNurse.get(nurse.id) ?? []
      const result = await sweepNurse(nurse, creds)
      nursesChecked++
      alertsCreated += result.alertsCreated
      if (result.suspended) suspensionsTriggered++
      if (result.error) errorCount++
    }

  } catch (err) {
    console.error('[ComplianceSweep] Fatal sweep error: %s', String(err))
    finalStatus = 'failed'
    errorCount++
  }

  const completedAt = new Date().toISOString()

  // Update sweep log row
  if (sweepLog?.id) {
    await supabase
      .from('compliance_sweep_log')
      .update({
        completed_at: completedAt,
        nurses_checked: nursesChecked,
        alerts_created: alertsCreated,
        suspensions_triggered: suspensionsTriggered,
        error_count: errorCount,
        status: finalStatus,
      })
      .eq('id', sweepLog.id)
  }

  // Audit log
  await writeAuditLog({
    actor_id: SYSTEM_UUID,
    action: 'compliance.sweep.completed',
    target_id: sweepId,
    target_type: 'compliance_sweep',
    metadata: {
      nurses_checked: nursesChecked,
      alerts_created: alertsCreated,
      suspensions_triggered: suspensionsTriggered,
      error_count: errorCount,
      status: finalStatus,
    },
  })

  console.info(
    '[ComplianceSweep] Completed. nurses=%d alerts=%d suspensions=%d errors=%d status=%s',
    nursesChecked, alertsCreated, suspensionsTriggered, errorCount, finalStatus,
  )

  return {
    sweepId,
    nursesChecked,
    alertsCreated,
    suspensionsTriggered,
    errorCount,
    status: finalStatus,
    startedAt,
    completedAt,
  }
}

// ── getSweepHistory ────────────────────────────────────────────────────────────

/**
 * getSweepHistory
 *
 * Returns the last N sweep log entries.
 */
export async function getSweepHistory(limit = 10): Promise<SweepLog[]> {
  const supabase = getAdminClient()

  const { data, error } = await supabase
    .from('compliance_sweep_log')
    .select('id, started_at, completed_at, nurses_checked, alerts_created, suspensions_triggered, error_count, status, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.warn('[ComplianceSweep] getSweepHistory failed: %s', error.message)
    return []
  }

  return (data ?? []) as SweepLog[]
}
