/**
 * NurseSphere Agent Stack — Core Types
 *
 * Every agent must implement AgentInterface.
 * All outputs are deterministic — no vague text, no nondeterministic strings.
 * Every agent writes to the DB. Alerts are events, not direct notifications.
 * Never log secrets, tokens, or PHI.
 */

// ── Agent Identity ─────────────────────────────────────────────────────────────

export type AgentName =
  | 'ComplianceGuardian'
  | 'CredentialIntelligence'
  | 'WorkforceOptimization'

export type AgentMode =
  | 'nightly'
  | 'shift_booking'
  | 'onboarding'
  | 'daily'
  | 'on_demand'

// ── Agent I/O ──────────────────────────────────────────────────────────────────

export interface AgentInput {
  agentName: AgentName
  mode: AgentMode
  runId?: string        // injected by AgentRunner
  nurseId?: string
  facilityId?: string
  credentialId?: string
  [key: string]: unknown
}

export interface AgentOutput {
  agentName: AgentName
  runId: string
  success: boolean
  startedAt: string     // ISO timestamp
  completedAt: string   // ISO timestamp
  result: unknown
  error?: string
}

export interface AgentInterface {
  name: AgentName
  run(input: AgentInput): Promise<AgentOutput>
}

// ── ComplianceGuardian ─────────────────────────────────────────────────────────

export interface ComplianceGuardianResult {
  nurseId: string
  facilityId: string | null
  pass: boolean
  missing: MissingCredential[]
  expired: ExpiredCredential[]
  expiring: ExpiringCredential[]
}

export interface MissingCredential {
  type: string
  required: boolean
}

export interface ExpiredCredential {
  credentialId: string
  type: string
  expiredAt: string
}

export interface ExpiringCredential {
  credentialId: string
  type: string
  expiresAt: string
  daysUntilExpiry: number
}

// ── CredentialIntelligence ────────────────────────────────────────────────────

export interface CredentialIntelligenceResult {
  credentialId: string
  extractedJson: ExtractedCredentialData
  statusUpdated: boolean
  newStatus: string
}

export interface ExtractedCredentialData {
  issuer: string | null
  issued_at: string | null   // ISO date YYYY-MM-DD
  expires_at: string | null  // ISO date YYYY-MM-DD
  license_number: string | null
  confidence: {
    issuer: number       // 0.0–1.0
    issued_at: number
    expires_at: number
    license_number: number
  }
  extraction_method: 'manual' | 'ocr' | 'ai' | 'placeholder'
  extracted_at: string   // ISO timestamp
}

// ── WorkforceOptimization ──────────────────────────────────────────────────────

export type RiskLevel = 'LOW' | 'MED' | 'HIGH' | 'CRITICAL'
export type CancellationTrend = 'STABLE' | 'RISING' | 'FALLING'

export interface WorkforceOptimizationResult {
  facilityId: string
  fillRate7d: number          // 0.0–1.0
  cancellationTrend: CancellationTrend
  riskLevel: RiskLevel
}

// ── Agent Alerts ──────────────────────────────────────────────────────────────

export type AgentAlertType =
  | 'CREDENTIAL_EXPIRING'
  | 'CREDENTIAL_EXPIRED'
  | 'COMPLIANCE_FAIL'
  | 'SHORTAGE_RISK'

export type AgentAlertSeverity = 'LOW' | 'MED' | 'HIGH'
export type AgentAlertStatus = 'NEW' | 'SENT' | 'ACKED'

export interface AgentAlertPayload {
  agentName: AgentName
  [key: string]: unknown
}
