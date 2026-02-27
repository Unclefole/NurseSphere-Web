/**
 * Compliance Alert Generator
 * Server-side only — uses service role client for upserts.
 *
 * Generates ComplianceAlert rows for:
 *   - expiring_30  (≤30 days, >7)     → severity: medium
 *   - expiring_7   (≤7 days, >0)      → severity: high
 *   - expired      (<0 days)           → severity: critical
 *   - missing_required                 → severity: critical
 */

import { createClient } from '@supabase/supabase-js'
import type { Credential, ComplianceAlert, AlertType, AlertSeverity } from './types'
import { REQUIRED_CREDENTIAL_TYPES } from './types'

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role env vars')
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function daysBetween(dateStr: string): number {
  const exp = new Date(dateStr)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  exp.setHours(0, 0, 0, 0)
  return Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

interface AlertSpec {
  alert_type: AlertType
  severity: AlertSeverity
  credential_id: string | null
  due_at: string | null
  evidence: Record<string, unknown>
}

function buildAlertSpecs(
  credentials: Credential[],
  requiredTypes: readonly string[] = REQUIRED_CREDENTIAL_TYPES
): AlertSpec[] {
  const specs: AlertSpec[] = []

  const activeTypes = new Set(
    credentials
      .filter((c) => c.status === 'active' || c.status === 'expiring')
      .map((c) => c.type)
  )

  for (const cred of credentials) {
    const days = daysBetween(cred.expiration_date)

    if (days < 0 || cred.status === 'expired') {
      specs.push({
        alert_type: 'expired',
        severity: 'critical',
        credential_id: cred.id,
        due_at: new Date(cred.expiration_date).toISOString(),
        evidence: {
          credential_id: cred.id,
          type: cred.type,
          expiration_date: cred.expiration_date,
          days_until_expiry: days,
          issuing_state: cred.issuing_state,
          number: cred.number,
        },
      })
    } else if (days <= 7) {
      specs.push({
        alert_type: 'expiring_7',
        severity: 'high',
        credential_id: cred.id,
        due_at: new Date(cred.expiration_date).toISOString(),
        evidence: {
          credential_id: cred.id,
          type: cred.type,
          expiration_date: cred.expiration_date,
          days_until_expiry: days,
          issuing_state: cred.issuing_state,
          number: cred.number,
        },
      })
    } else if (days <= 30) {
      specs.push({
        alert_type: 'expiring_30',
        severity: 'medium',
        credential_id: cred.id,
        due_at: new Date(cred.expiration_date).toISOString(),
        evidence: {
          credential_id: cred.id,
          type: cred.type,
          expiration_date: cred.expiration_date,
          days_until_expiry: days,
          issuing_state: cred.issuing_state,
          number: cred.number,
        },
      })
    }
  }

  // Missing required credentials
  for (const reqType of requiredTypes) {
    if (!activeTypes.has(reqType)) {
      specs.push({
        alert_type: 'missing_required',
        severity: 'critical',
        credential_id: null,
        due_at: null,
        evidence: {
          type: reqType,
          reason: 'Required credential not found or not active',
        },
      })
    }
  }

  return specs
}

/**
 * generateAlerts
 *
 * Upserts compliance_alerts for a nurse+facility.
 * Returns the generated alerts.
 * HIPAA: no PHI in logs — we only log counts.
 */
export async function generateAlerts(
  nurseId: string,
  facilityId: string,
  credentials: Credential[],
  requiredTypes: readonly string[] = REQUIRED_CREDENTIAL_TYPES
): Promise<ComplianceAlert[]> {
  const supabase = createAdminClient()
  const specs = buildAlertSpecs(credentials, requiredTypes)

  if (specs.length === 0) {
    // Resolve any previously open alerts that are no longer relevant
    await supabase
      .from('compliance_alerts')
      .update({ status: 'resolved' })
      .eq('nurse_id', nurseId)
      .eq('facility_id', facilityId)
      .eq('status', 'open')
    return []
  }

  const rows = specs.map((s) => ({
    facility_id: facilityId,
    nurse_id: nurseId,
    credential_id: s.credential_id,
    alert_type: s.alert_type,
    severity: s.severity,
    due_at: s.due_at,
    status: 'open' as const,
    evidence: s.evidence,
  }))

  // Upsert by (facility_id, nurse_id, alert_type, credential_id)
  // We insert new rows; duplicates update severity/evidence/due_at
  const { data, error } = await supabase
    .from('compliance_alerts')
    .upsert(rows, {
      onConflict: 'facility_id,nurse_id,alert_type,credential_id',
      ignoreDuplicates: false,
    })
    .select()

  if (error) {
    // Fallback: insert without upsert if no unique index exists yet
    const { data: inserted } = await supabase
      .from('compliance_alerts')
      .insert(rows)
      .select()
    return (inserted as ComplianceAlert[]) ?? []
  }

  return (data as ComplianceAlert[]) ?? []
}

/**
 * Pure version — no DB — for testing
 */
export function generateAlertSpecs(
  credentials: Credential[],
  requiredTypes: readonly string[] = REQUIRED_CREDENTIAL_TYPES
): AlertSpec[] {
  return buildAlertSpecs(credentials, requiredTypes)
}
