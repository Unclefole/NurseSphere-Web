/**
 * Server-side audit logging — writes to Supabase `audit_logs` table.
 * Safe to call from API route handlers.
 * Phantom guard: if the table doesn't exist yet, logs to console without throwing.
 *
 * Schema (single write path — all callers must use writeAuditLog):
 *   actor_id:    string | null  — auth user UUID (never email or name)
 *   facility_id: string | null  — facility context
 *   action:      string         — e.g. 'credential.verified', 'invoice.paid'
 *   target_id:   string | null  — UUID of the affected resource
 *   target_type: string | null  — e.g. 'credential', 'invoice', 'shift'
 *   metadata:    object | null  — non-PHI contextual data
 *   ip_address:  string | null  — from request headers if available
 */
import { createClient } from '@supabase/supabase-js'

export interface AuditLogEntry {
  actor_id: string | null       // auth user UUID — always required, never email/name
  facility_id?: string | null   // facility context
  action: string                // e.g. 'credential.verified', 'invoice.paid'
  target_id?: string | null     // UUID of the affected resource
  target_type?: string | null   // e.g. 'credential', 'invoice', 'shift'
  metadata?: Record<string, unknown> | null  // non-PHI contextual data
  ip_address?: string | null    // from request headers if available
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !serviceKey) {
    throw new Error('Supabase configuration is missing for audit logging.')
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const supabase = getServiceClient()
    const { error } = await supabase.from('audit_logs').insert({
      actor_id: entry.actor_id,
      facility_id: entry.facility_id ?? null,
      action: entry.action,
      target_id: entry.target_id ?? null,
      target_type: entry.target_type ?? null,
      metadata: entry.metadata ?? null,
      ip_address: entry.ip_address ?? null,
      created_at: new Date().toISOString(),
    })
    if (error) {
      // Phantom guard — table may not exist yet
      console.warn('[AuditLog] Insert failed (table may not exist yet):', error.message)
    }
  } catch (err) {
    console.error('[AuditLog] Unexpected error:', err)
  }
}

/**
 * Extract IP address from Next.js Request headers.
 */
export function extractRequestMeta(request: Request): {
  ip_address: string | null
} {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    null
  return { ip_address: ip }
}
