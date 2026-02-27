/**
 * Credential Expiration Checker
 * Queries credentials table for expiring/expired credentials and surfaces alerts.
 * All operations are audit-logged per HIPAA compliance requirements.
 */

import { createClient } from '@supabase/supabase-js'
import { writeAuditLog } from '@/lib/audit'

// Server-side admin client (bypasses RLS for cron/scheduled operations)
function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export type CredentialAlertSeverity = 'expiring_soon' | 'expiring_critical' | 'expired'

export interface CredentialAlert {
  credentialId: string
  userId: string
  documentType: string
  documentName: string
  expiresAt: string
  daysUntilExpiry: number
  severity: CredentialAlertSeverity
}

export interface ExpirationCheckResult {
  checked: number
  flaggedExpiringSoon: number    // 8–30 days
  flaggedExpiringCritical: number // 1–7 days
  flaggedExpired: number
  errors: string[]
}

/**
 * Writes an audit log entry via the centralized writeAuditLog function.
 */
async function auditLog(
  action: string,
  targetType: string,
  targetId: string | null,
  metadata: Record<string, unknown>
): Promise<void> {
  await writeAuditLog({
    actor_id: null, // system/cron — no human actor
    action,
    target_type: targetType,
    target_id: targetId,
    metadata,
  })
}

/**
 * checkExpiringCredentials
 * Queries all credentials expiring within `daysAhead` days (but not yet expired).
 * Updates their status to 'expiring_soon' or 'expiring_critical' as appropriate.
 * Audit-logs each batch operation.
 */
export async function checkExpiringCredentials(daysAhead: number): Promise<ExpirationCheckResult> {
  const supabase = createAdminClient()
  const result: ExpirationCheckResult = {
    checked: 0,
    flaggedExpiringSoon: 0,
    flaggedExpiringCritical: 0,
    flaggedExpired: 0,
    errors: [],
  }

  const now = new Date()
  const futureDate = new Date()
  futureDate.setDate(futureDate.getDate() + daysAhead)

  // Fetch credentials expiring in the window
  const { data: credentials, error: fetchError } = await supabase
    .from('credentials')
    .select('id, user_id, document_type, document_name, expires_at, status')
    .not('expires_at', 'is', null)
    .gt('expires_at', now.toISOString())
    .lte('expires_at', futureDate.toISOString())

  if (fetchError) {
    result.errors.push(`Fetch error: ${fetchError.message}`)
    return result
  }

  result.checked = credentials?.length ?? 0

  for (const cred of credentials ?? []) {
    const expiresAt = new Date(cred.expires_at)
    const msUntilExpiry = expiresAt.getTime() - now.getTime()
    const daysUntilExpiry = Math.ceil(msUntilExpiry / (1000 * 60 * 60 * 24))

    let newStatus: string
    if (daysUntilExpiry <= 7) {
      newStatus = 'expiring_critical'
      result.flaggedExpiringCritical++
    } else {
      newStatus = 'expiring_soon'
      result.flaggedExpiringSoon++
    }

    // Only update if status is changing
    if (cred.status === newStatus) continue

    const { error: updateError } = await supabase
      .from('credentials')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', cred.id)

    if (updateError) {
      result.errors.push(`Update error for ${cred.id}: ${updateError.message}`)
      continue
    }

    await auditLog('credential.status_updated', 'credentials', cred.id, {
      userId: cred.user_id,
      documentType: cred.document_type,
      previousStatus: cred.status,
      newStatus,
      daysUntilExpiry,
      triggeredBy: 'expiration-checker-cron',
    })
  }

  return result
}

/**
 * flagExpiredCredentials
 * Finds all credentials whose expires_at is in the past and sets status = 'expired'.
 * Audit-logs each update.
 */
export async function flagExpiredCredentials(): Promise<ExpirationCheckResult> {
  const supabase = createAdminClient()
  const result: ExpirationCheckResult = {
    checked: 0,
    flaggedExpiringSoon: 0,
    flaggedExpiringCritical: 0,
    flaggedExpired: 0,
    errors: [],
  }

  const now = new Date().toISOString()

  const { data: expired, error: fetchError } = await supabase
    .from('credentials')
    .select('id, user_id, document_type, document_name, expires_at, status')
    .not('expires_at', 'is', null)
    .lt('expires_at', now)
    .neq('status', 'expired')

  if (fetchError) {
    result.errors.push(`Fetch error: ${fetchError.message}`)
    return result
  }

  result.checked = expired?.length ?? 0

  for (const cred of expired ?? []) {
    const { error: updateError } = await supabase
      .from('credentials')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', cred.id)

    if (updateError) {
      result.errors.push(`Update error for ${cred.id}: ${updateError.message}`)
      continue
    }

    result.flaggedExpired++

    await auditLog('credential.expired', 'credentials', cred.id, {
      userId: cred.user_id,
      documentType: cred.document_type,
      documentName: cred.document_name,
      expiresAt: cred.expires_at,
      previousStatus: cred.status,
      triggeredBy: 'expiration-checker-cron',
    })
  }

  return result
}

/**
 * getCredentialAlerts
 * Returns an array of alerts for a specific user's credentials.
 * Includes expiring_soon, expiring_critical, and expired credentials.
 */
export async function getCredentialAlerts(userId: string): Promise<CredentialAlert[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('credentials')
    .select('id, user_id, document_type, document_name, expires_at, status')
    .eq('user_id', userId)
    .not('expires_at', 'is', null)
    .in('status', ['expiring_soon', 'expiring_critical', 'expired'])
    .order('expires_at', { ascending: true })

  if (error) {
    console.error('[getCredentialAlerts] Error:', error.message)
    return []
  }

  const now = new Date()
  const alerts: CredentialAlert[] = (data ?? []).map((cred) => {
    const expiresAt = new Date(cred.expires_at)
    const msUntilExpiry = expiresAt.getTime() - now.getTime()
    const daysUntilExpiry = Math.ceil(msUntilExpiry / (1000 * 60 * 60 * 24))

    let severity: CredentialAlertSeverity
    if (daysUntilExpiry <= 0) {
      severity = 'expired'
    } else if (daysUntilExpiry <= 7) {
      severity = 'expiring_critical'
    } else {
      severity = 'expiring_soon'
    }

    return {
      credentialId: cred.id,
      userId: cred.user_id,
      documentType: cred.document_type,
      documentName: cred.document_name,
      expiresAt: cred.expires_at,
      daysUntilExpiry,
      severity,
    }
  })

  await auditLog('credential.alerts_fetched', 'credentials', null, {
    userId,
    alertCount: alerts.length,
    triggeredBy: 'getCredentialAlerts',
  })

  return alerts
}
