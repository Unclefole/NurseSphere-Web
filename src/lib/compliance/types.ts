/**
 * Compliance Guardian — shared TypeScript types
 * Server-side only — never import from client components directly.
 */

export type CredentialStatus =
  | 'active'
  | 'expiring'
  | 'expired'
  | 'pending_verification'
  | 'rejected'

export type AlertType =
  | 'expiring_30'
  | 'expiring_7'
  | 'expired'
  | 'mismatch'
  | 'missing_required'
  | 'sanction_check_failed'
  | 'oig_check_due'

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical'
export type AlertStatus = 'open' | 'acknowledged' | 'resolved'

export interface Credential {
  id: string
  nurse_id: string
  facility_id: string | null
  type: string
  issuing_state: string | null
  number: string | null
  status: CredentialStatus
  expiration_date: string // ISO date YYYY-MM-DD
  verified_at: string | null
  verified_by: string | null
  source: 'upload' | 'manual' | 'api'
  created_at: string
  updated_at: string
}

export interface ComplianceAlert {
  id: string
  facility_id: string
  nurse_id: string
  credential_id: string | null
  alert_type: AlertType
  severity: AlertSeverity
  due_at: string | null
  status: AlertStatus
  evidence: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ScoreReason {
  type: AlertType | 'pending_verification'
  credential_type: string
  credential_id?: string
  deduction: number
  detail: string
}

export interface ComplianceScore {
  score: number
  reasons: ScoreReason[]
  computed_at: string
}

/** Required credential types per facility (can be extended per facility config) */
export const REQUIRED_CREDENTIAL_TYPES = [
  'RN_LICENSE',
  'BLS',
  'ACLS',
] as const
