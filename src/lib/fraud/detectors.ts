/**
 * Fraud + Identity Shield — Detection Logic
 * SERVER ONLY — never import from client components.
 * All detectors run server-side; no PHI in logs.
 */

import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { writeAuditLog } from '@/lib/audit'

export type FraudEventType =
  | 'duplicate_account'
  | 'ip_anomaly'
  | 'rapid_cancellations'
  | 'payment_anomaly'
  | 'credential_mismatch'
  | 'login_burst'

export type FraudSeverity = 'low' | 'medium' | 'high' | 'critical'
export type FraudStatus = 'open' | 'investigating' | 'closed' | 'false_positive'

export interface SuspiciousEvent {
  id: string
  facility_id: string | null
  nurse_id: string | null
  event_type: FraudEventType
  severity: FraudSeverity
  evidence: Record<string, unknown>
  status: FraudStatus
  resolved_by: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export interface FraudCheckContext {
  email?: string
  phone?: string
  ip?: string
  region?: string
  facilityId?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual Detectors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect duplicate accounts sharing the same email or phone number.
 * HIPAA: evidence only stores user IDs and matching field name — no raw PHI.
 */
export async function detectDuplicateAccount(
  userId: string,
  email?: string,
  phone?: string
): Promise<SuspiciousEvent | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseAdminClient() as any

  if (!email && !phone) return null

  // Check email match
  if (email) {
    const { data: emailMatch } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .neq('id', userId)
      .limit(1)
      .maybeSingle()

    if (emailMatch) {
      return await insertSuspiciousEvent({
        nurse_id: userId,
        facility_id: null,
        event_type: 'duplicate_account',
        evidence: {
          existing_user_id: (emailMatch as { id: string }).id,
          matching_field: 'email',
          matched_value: '[redacted]', // Never log raw email
        },
      })
    }
  }

  // Check phone match
  if (phone) {
    const { data: phoneMatch } = await supabase
      .from('profiles')
      .select('id')
      .eq('phone', phone)
      .neq('id', userId)
      .limit(1)
      .maybeSingle()

    if (phoneMatch) {
      return await insertSuspiciousEvent({
        nurse_id: userId,
        facility_id: null,
        event_type: 'duplicate_account',
        evidence: {
          existing_user_id: (phoneMatch as { id: string }).id,
          matching_field: 'phone',
          matched_value: '[redacted]', // Never log raw phone
        },
      })
    }
  }

  return null
}

/**
 * Detect rapid shift cancellations (>3 in last 7 days) suggesting gaming the system.
 */
export async function detectRapidCancellations(
  nurseId: string,
  facilityId?: string
): Promise<SuspiciousEvent | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseAdminClient() as any
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: cancellations, error } = await supabase
    .from('shifts')
    .select('id')
    .eq('nurse_id', nurseId)
    .eq('status', 'cancelled')
    .gte('updated_at', sevenDaysAgo)

  if (error || !cancellations) return null

  const count = (cancellations as { id: string }[]).length
  if (count <= 3) return null

  return await insertSuspiciousEvent({
    nurse_id: nurseId,
    facility_id: facilityId ?? null,
    event_type: 'rapid_cancellations',
    evidence: {
      cancellation_count: count,
      period_days: 7,
      shift_ids: (cancellations as { id: string }[]).map((s) => s.id),
    },
  })
}

/**
 * Detect IP anomalies by comparing current login IP/region to the last known one.
 * Stub: actual geo-lookup is not performed; relies on headers/caller passing region.
 */
export async function detectIpAnomaly(
  userId: string,
  currentIp: string | null,
  currentRegion: string | null
): Promise<SuspiciousEvent | null> {
  if (!currentIp) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseAdminClient() as any

  // Look up the most recent audit log entry with an IP address for this user
  const { data: lastLogRaw, error } = await supabase
    .from('audit_logs')
    .select('ip_address, details')
    .eq('actor_id', userId)
    .not('ip_address', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const lastLog = lastLogRaw as { ip_address: string | null; details: Record<string, unknown> | null } | null

  if (error || !lastLog || !lastLog.ip_address) return null

  const previousIp = lastLog.ip_address as string
  const previousRegion = lastLog.details?.region as string | null ?? null

  // If IP changed AND region changed → flag
  if (previousIp === currentIp) return null
  if (!currentRegion || !previousRegion) return null
  if (currentRegion === previousRegion) return null

  return await insertSuspiciousEvent({
    nurse_id: userId,
    facility_id: null,
    event_type: 'ip_anomaly',
    evidence: {
      previous_ip: previousIp,
      current_ip: currentIp,
      previous_region: previousRegion,
      current_region: currentRegion,
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run all fraud detectors for a user. Writes events to suspicious_events table.
 * Returns all triggered events.
 */
export async function runFraudChecks(
  userId: string,
  context: FraudCheckContext
): Promise<SuspiciousEvent[]> {
  const triggered: SuspiciousEvent[] = []

  // Run detectors in parallel
  const [dupeEvent, cancellationEvent, ipEvent] = await Promise.allSettled([
    detectDuplicateAccount(userId, context.email, context.phone),
    detectRapidCancellations(userId, context.facilityId),
    detectIpAnomaly(userId, context.ip ?? null, context.region ?? null),
  ])

  if (dupeEvent.status === 'fulfilled' && dupeEvent.value) triggered.push(dupeEvent.value)
  if (cancellationEvent.status === 'fulfilled' && cancellationEvent.value) triggered.push(cancellationEvent.value)
  if (ipEvent.status === 'fulfilled' && ipEvent.value) triggered.push(ipEvent.value)

  // Audit log the fraud check run (no PHI)
  await writeAuditLog({
    actor_id: userId,
    action: 'fraud_check_run',
    target_type: 'suspicious_events',
    target_id: null,
    metadata: {
      events_triggered: triggered.length,
      checks_run: ['duplicate_account', 'rapid_cancellations', 'ip_anomaly'],
    },
  })

  return triggered
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper
// ─────────────────────────────────────────────────────────────────────────────

interface InsertEventParams {
  nurse_id: string | null
  facility_id: string | null
  event_type: FraudEventType
  evidence: Record<string, unknown>
}

async function insertSuspiciousEvent(
  params: InsertEventParams
): Promise<SuspiciousEvent | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createSupabaseAdminClient() as any

  const { data, error } = await supabase
    .from('suspicious_events')
    .insert({
      nurse_id: params.nurse_id,
      facility_id: params.facility_id,
      event_type: params.event_type,
      evidence: params.evidence,
      status: 'open',
    })
    .select()
    .single()

  if (error) {
    // Phantom guard — table may not exist yet in dev
    console.warn('[FraudDetector] Insert failed:', error.message)
    return null
  }

  return data as SuspiciousEvent
}

/**
 * Compute overall risk level from a list of triggered events.
 */
export function computeRiskLevel(events: SuspiciousEvent[]): string {
  if (events.length === 0) return 'low'
  const hasCritical = events.some((e) => e.severity === 'critical')
  const hasHigh = events.some((e) => e.severity === 'high')
  const hasMedium = events.some((e) => e.severity === 'medium')
  if (hasCritical) return 'critical'
  if (hasHigh) return 'high'
  if (hasMedium) return 'medium'
  return 'low'
}
