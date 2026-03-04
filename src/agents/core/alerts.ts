/**
 * Agent Alerts — writes to agent_alerts table.
 *
 * Alerts are events, not direct notifications.
 * Delivery (email, push, webhook) is handled by a separate notification layer.
 *
 * PHI rules:
 *   - payload must contain only UUIDs and non-PHI metadata
 *   - never log nurse names, emails, or clinical details
 *   - never log tokens or secrets
 */

import { createClient } from '@supabase/supabase-js'
import type { AgentAlertType, AgentAlertSeverity, AgentAlertPayload } from './types'

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role env vars')
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export interface EmitAlertOptions {
  userId: string                 // nurse or admin UUID (never name or email)
  type: AgentAlertType
  severity: AgentAlertSeverity
  payload: AgentAlertPayload
}

/**
 * Emit a single agent alert.
 * Phantom-guarded: if the table doesn't exist yet, logs a warning without throwing.
 */
export async function emitAlert(opts: EmitAlertOptions): Promise<void> {
  try {
    const supabase = getAdminClient()
    const { error } = await supabase.from('agent_alerts').insert({
      user_id: opts.userId,
      type: opts.type,
      severity: opts.severity,
      payload: opts.payload,
      status: 'NEW',
      created_at: new Date().toISOString(),
    })
    if (error) {
      // Phantom guard — table may not be provisioned yet
      console.warn('[AgentAlerts] Insert failed (table may not exist yet):', error.message)
    }
  } catch (err) {
    console.error('[AgentAlerts] Unexpected error (no tokens/secrets in this log):', (err as Error).message)
  }
}

/**
 * Emit multiple alerts in parallel.
 */
export async function emitAlerts(alerts: EmitAlertOptions[]): Promise<void> {
  await Promise.all(alerts.map(emitAlert))
}
