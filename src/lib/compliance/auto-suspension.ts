/**
 * Auto-Suspension Service
 * NurseSphere TIER 1 — Continuous Compliance Engine
 *
 * Manages nurse status lifecycle: active → suspended / restricted → active
 *
 * PHI rules:
 *   - No patient data stored
 *   - No nurse SSN/DOB in logs or evidence
 *   - evidence object is sanitized before storage (credential IDs only)
 *   - audit_log uses actor_id UUID only
 *
 * Server-side only — never import from client components.
 */

import { createClient } from '@supabase/supabase-js'
import { writeAuditLog } from '@/lib/audit'

// ── Constants ──────────────────────────────────────────────────────────────────

export const SYSTEM_UUID = '00000000-0000-0000-0000-000000000001'

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

export interface SuspensionResult {
  success: boolean
  nurseId: string
  reason: string
  error?: string
}

export interface NurseStatusResult {
  nurseId: string
  status: 'active' | 'suspended' | 'restricted'
  suspension_reason: string | null
  suspended_at: string | null
}

// ── Evidence sanitizer ─────────────────────────────────────────────────────────

/**
 * Sanitize evidence object: keep only non-PHI credential metadata.
 * Strip any fields that could contain names, SSN, DOB, or patient data.
 */
function sanitizeEvidence(raw: Record<string, unknown>): Record<string, unknown> {
  const ALLOWED_KEYS = [
    'credential_id',
    'credential_type',
    'license_number',
    'issuing_state',
    'expiration_date',
    'exclusion_date',
    'source',
    'oig_status',
    'nursys_status',
    'sam_status',
    'check_type',
    'alert_type',
    'checked_at',
    'npi',
  ]
  const sanitized: Record<string, unknown> = {}
  for (const key of ALLOWED_KEYS) {
    if (key in raw) sanitized[key] = raw[key]
  }
  return sanitized
}

// ── createComplianceAlert helper ───────────────────────────────────────────────

async function createComplianceAlert(params: {
  nurseId: string
  facilityId: string | null
  alertType: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  evidence: Record<string, unknown>
}): Promise<void> {
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
    console.warn('[AutoSuspension] Failed to create compliance_alert for nurse %s: %s', params.nurseId, error.message)
  }
}

// ── getFacilityId helper ───────────────────────────────────────────────────────

async function getNurseFacilityId(nurseId: string): Promise<string | null> {
  const supabase = getAdminClient()
  const { data } = await supabase
    .from('shift_assignments')
    .select('facility_id')
    .eq('nurse_id', nurseId)
    .limit(1)
    .maybeSingle()
  return data?.facility_id ?? null
}

// ── suspendNurse ───────────────────────────────────────────────────────────────

/**
 * suspendNurse
 *
 * Sets nurse status to 'suspended'. Creates audit log + compliance alert.
 * actorId defaults to SYSTEM_UUID when called from automated sweep.
 *
 * PHI-safe: evidence is sanitized before storage.
 */
export async function suspendNurse(
  nurseId: string,
  reason: string,
  evidence: Record<string, unknown>,
  actorId: string = SYSTEM_UUID,
): Promise<SuspensionResult> {
  const supabase = getAdminClient()

  const sanitized = sanitizeEvidence(evidence)

  const { error } = await supabase
    .from('profiles')
    .update({
      status: 'suspended',
      suspension_reason: reason,
      suspension_evidence: sanitized,
      suspended_at: new Date().toISOString(),
      suspended_by: actorId,
    })
    .eq('id', nurseId)

  if (error) {
    console.error('[AutoSuspension] Failed to suspend nurse %s: %s', nurseId, error.message)
    return { success: false, nurseId, reason, error: error.message }
  }

  // Audit log — actor_id only, no PHI
  await writeAuditLog({
    actor_id: actorId,
    action: 'nurse.suspended',
    target_id: nurseId,
    target_type: 'nurse',
    metadata: { reason, nurse_id: nurseId },
  })

  // Compliance alert
  const facilityId = await getNurseFacilityId(nurseId)
  await createComplianceAlert({
    nurseId,
    facilityId,
    alertType: 'suspension',
    severity: 'critical',
    evidence: { ...sanitized, reason, actor_id: actorId },
  })

  console.info('[AutoSuspension] Nurse suspended. nurseId=%s reason=%s actor=%s', nurseId, reason, actorId)
  return { success: true, nurseId, reason }
}

// ── restrictNurse ──────────────────────────────────────────────────────────────

/**
 * restrictNurse
 *
 * Sets nurse status to 'restricted'. Nurse can view but not pick up shifts.
 * Less severe than suspension — used for minor license issues.
 */
export async function restrictNurse(
  nurseId: string,
  reason: string,
  evidence: Record<string, unknown>,
  actorId: string = SYSTEM_UUID,
): Promise<SuspensionResult> {
  const supabase = getAdminClient()

  const sanitized = sanitizeEvidence(evidence)

  const { error } = await supabase
    .from('profiles')
    .update({
      status: 'restricted',
      suspension_reason: reason,
      suspension_evidence: sanitized,
      suspended_at: new Date().toISOString(),
      suspended_by: actorId,
    })
    .eq('id', nurseId)

  if (error) {
    console.error('[AutoSuspension] Failed to restrict nurse %s: %s', nurseId, error.message)
    return { success: false, nurseId, reason, error: error.message }
  }

  await writeAuditLog({
    actor_id: actorId,
    action: 'nurse.restricted',
    target_id: nurseId,
    target_type: 'nurse',
    metadata: { reason, nurse_id: nurseId },
  })

  const facilityId = await getNurseFacilityId(nurseId)
  await createComplianceAlert({
    nurseId,
    facilityId,
    alertType: 'restriction',
    severity: 'high',
    evidence: { ...sanitized, reason, actor_id: actorId },
  })

  console.info('[AutoSuspension] Nurse restricted. nurseId=%s reason=%s actor=%s', nurseId, reason, actorId)
  return { success: true, nurseId, reason }
}

// ── reinstateNurse ─────────────────────────────────────────────────────────────

/**
 * reinstateNurse
 *
 * Restores nurse status to 'active'. Requires explicit actorId — no self-reinstatement.
 * Clears all suspension fields.
 */
export async function reinstateNurse(
  nurseId: string,
  actorId: string,
  justification: string,
): Promise<SuspensionResult> {
  if (!actorId || actorId === SYSTEM_UUID) {
    return {
      success: false,
      nurseId,
      reason: 'reinstatement',
      error: 'actorId is required for reinstatement — system cannot auto-reinstate',
    }
  }

  const supabase = getAdminClient()

  const { error } = await supabase
    .from('profiles')
    .update({
      status: 'active',
      suspension_reason: null,
      suspension_evidence: null,
      suspended_at: null,
      suspended_by: null,
    })
    .eq('id', nurseId)

  if (error) {
    console.error('[AutoSuspension] Failed to reinstate nurse %s: %s', nurseId, error.message)
    return { success: false, nurseId, reason: 'reinstatement', error: error.message }
  }

  await writeAuditLog({
    actor_id: actorId,
    action: 'nurse.reinstated',
    target_id: nurseId,
    target_type: 'nurse',
    metadata: { justification, nurse_id: nurseId },
  })

  console.info('[AutoSuspension] Nurse reinstated. nurseId=%s actor=%s', nurseId, actorId)
  return { success: true, nurseId, reason: 'reinstated' }
}

// ── getNurseStatus ─────────────────────────────────────────────────────────────

/**
 * getNurseStatus
 *
 * Returns current status + suspension reason + suspended_at.
 * No PHI returned.
 */
export async function getNurseStatus(nurseId: string): Promise<NurseStatusResult | null> {
  const supabase = getAdminClient()

  const { data, error } = await supabase
    .from('profiles')
    .select('id, status, suspension_reason, suspended_at')
    .eq('id', nurseId)
    .maybeSingle()

  if (error || !data) {
    console.warn('[AutoSuspension] getNurseStatus failed for nurseId=%s: %s', nurseId, error?.message)
    return null
  }

  return {
    nurseId: data.id,
    status: data.status ?? 'active',
    suspension_reason: data.suspension_reason ?? null,
    suspended_at: data.suspended_at ?? null,
  }
}

// ── isNurseEligible ────────────────────────────────────────────────────────────

/**
 * isNurseEligible
 *
 * Returns true only if nurse status is 'active'.
 * Used as a fast gate for shift pickup eligibility.
 */
export async function isNurseEligible(nurseId: string): Promise<boolean> {
  const status = await getNurseStatus(nurseId)
  return status?.status === 'active'
}
