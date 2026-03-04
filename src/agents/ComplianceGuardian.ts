/**
 * ComplianceGuardian Agent
 *
 * Checks a nurse's credential status against compliance_rules for a facility/state/role.
 * Writes compliance_checks row with full details.
 * Emits agent_alerts for every expiring, expired, or missing required credential.
 *
 * Modes:
 *   nightly        — called for each active nurse during nightly sweep
 *   shift_booking  — called before a shift is confirmed for a specific nurse + facility
 *   onboarding     — called when a nurse completes onboarding
 *
 * PHI rules:
 *   - No nurse names, emails, or DOB in any log or DB write
 *   - All references to nurses use UUID only
 *   - compliance_checks.details contains only credential UUIDs + type enums
 *
 * Server-side only.
 */

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import type {
  AgentInterface,
  AgentInput,
  AgentOutput,
  ComplianceGuardianResult,
  MissingCredential,
  ExpiredCredential,
  ExpiringCredential,
  AgentAlertSeverity,
} from './core/types'
import { emitAlerts } from './core/alerts'

// ── Supabase admin client ──────────────────────────────────────────────────────

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role env vars')
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ── Expiry helpers ─────────────────────────────────────────────────────────────

function daysUntilExpiry(expiresAt: string): number {
  const now = new Date()
  const exp = new Date(expiresAt)
  return Math.floor((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date()
}

// ── Credential type config ─────────────────────────────────────────────────────

interface RequiredCredentialRule {
  type: string
  required: boolean
  warn_days?: number  // default 30
}

const DEFAULT_REQUIRED_CREDENTIALS: RequiredCredentialRule[] = [
  { type: 'RN_LICENSE',     required: true,  warn_days: 30 },
  { type: 'BLS',            required: true,  warn_days: 30 },
  { type: 'ACLS',           required: true,  warn_days: 14 },
  { type: 'TB',             required: true,  warn_days: 30 },
  { type: 'IMMUNIZATION',   required: false, warn_days: 30 },
]

// ── Main agent class ───────────────────────────────────────────────────────────

export class ComplianceGuardian implements AgentInterface {
  readonly name = 'ComplianceGuardian' as const

  async run(input: AgentInput): Promise<AgentOutput> {
    const runId = input.runId ?? randomUUID()
    const startedAt = new Date().toISOString()

    try {
      const result = await this._check(input)

      return {
        agentName: this.name,
        runId,
        success: true,
        startedAt,
        completedAt: new Date().toISOString(),
        result,
      }
    } catch (err) {
      return {
        agentName: this.name,
        runId,
        success: false,
        startedAt,
        completedAt: new Date().toISOString(),
        result: null,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  private async _check(input: AgentInput): Promise<ComplianceGuardianResult> {
    const { nurseId, facilityId, mode } = input
    if (!nurseId) throw new Error('ComplianceGuardian: nurseId is required')

    const supabase = getAdminClient()

    // ── 1. Load nurse credentials ──────────────────────────────────────────────
    const { data: credentials, error: credErr } = await supabase
      .from('credentials')
      .select('id, type, status, expiration_date')
      .eq('nurse_id', nurseId)

    if (credErr) throw new Error(`Failed to load credentials: ${credErr.message}`)
    const creds = credentials ?? []

    // ── 2. Load compliance rules for this facility/state/role ──────────────────
    let rules: RequiredCredentialRule[] = DEFAULT_REQUIRED_CREDENTIALS

    if (facilityId) {
      const { data: facilityRules } = await supabase
        .from('compliance_rules')
        .select('required_credentials')
        .eq('facility_id', facilityId)
        .order('effective_date', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (facilityRules?.required_credentials) {
        try {
          const parsed = facilityRules.required_credentials as RequiredCredentialRule[]
          if (Array.isArray(parsed) && parsed.length > 0) {
            rules = parsed
          }
        } catch {
          // Phantom guard — malformed rule JSON falls back to defaults
        }
      }
    }

    // ── 3. Evaluate against rules ──────────────────────────────────────────────
    const missing: MissingCredential[] = []
    const expired: ExpiredCredential[] = []
    const expiring: ExpiringCredential[] = []

    for (const rule of rules) {
      const matches = creds.filter(
        (c) => c.type?.toUpperCase() === rule.type.toUpperCase()
      )

      if (matches.length === 0) {
        missing.push({ type: rule.type, required: rule.required })
        continue
      }

      // Use the most recent (last) credential for this type
      const cred = matches[matches.length - 1]

      if (!cred.expiration_date) continue  // no expiry = treat as valid

      if (isExpired(cred.expiration_date)) {
        expired.push({
          credentialId: cred.id,
          type: rule.type,
          expiredAt: cred.expiration_date,
        })
        continue
      }

      const days = daysUntilExpiry(cred.expiration_date)
      const warnDays = rule.warn_days ?? 30
      if (days <= warnDays) {
        expiring.push({
          credentialId: cred.id,
          type: rule.type,
          expiresAt: cred.expiration_date,
          daysUntilExpiry: days,
        })
      }
    }

    const requiredMissing = missing.filter((m) => m.required)
    const pass =
      requiredMissing.length === 0 && expired.length === 0

    // ── 4. Write compliance_checks row ────────────────────────────────────────
    const checkType =
      mode === 'shift_booking' ? 'SHIFT_BOOKING'
      : mode === 'onboarding' ? 'ONBOARDING'
      : 'NIGHTLY_SWEEP'

    const checkResult = pass ? 'PASS' : missing.some((m) => m.required) || expired.length > 0 ? 'FAIL' : 'WARN'

    await supabase.from('compliance_checks').insert({
      nurse_id: nurseId,
      facility_id: facilityId ?? null,
      check_type: checkType,
      result: checkResult,
      details: {
        missing: missing.map((m) => ({ type: m.type, required: m.required })),
        expired: expired.map((e) => ({ credential_id: e.credentialId, type: e.type, expired_at: e.expiredAt })),
        expiring: expiring.map((x) => ({
          credential_id: x.credentialId,
          type: x.type,
          expires_at: x.expiresAt,
          days_until_expiry: x.daysUntilExpiry,
        })),
        run_mode: mode,
      },
      created_at: new Date().toISOString(),
    })

    // ── 5. Emit alerts ────────────────────────────────────────────────────────
    const alertsToEmit = []

    for (const exp of expired) {
      alertsToEmit.push({
        userId: nurseId,
        type: 'CREDENTIAL_EXPIRED' as const,
        severity: 'HIGH' as AgentAlertSeverity,
        payload: {
          agentName: this.name,
          credentialId: exp.credentialId,
          credentialType: exp.type,
          expiredAt: exp.expiredAt,
          facilityId: facilityId ?? null,
        },
      })
    }

    for (const exp of expiring) {
      const severity: AgentAlertSeverity =
        exp.daysUntilExpiry <= 7 ? 'HIGH' : exp.daysUntilExpiry <= 14 ? 'MED' : 'LOW'
      alertsToEmit.push({
        userId: nurseId,
        type: 'CREDENTIAL_EXPIRING' as const,
        severity,
        payload: {
          agentName: this.name,
          credentialId: exp.credentialId,
          credentialType: exp.type,
          expiresAt: exp.expiresAt,
          daysUntilExpiry: exp.daysUntilExpiry,
          facilityId: facilityId ?? null,
        },
      })
    }

    if (!pass) {
      alertsToEmit.push({
        userId: nurseId,
        type: 'COMPLIANCE_FAIL' as const,
        severity: 'HIGH' as AgentAlertSeverity,
        payload: {
          agentName: this.name,
          checkType,
          checkResult,
          facilityId: facilityId ?? null,
          missingRequired: requiredMissing.map((m) => m.type),
          expiredTypes: expired.map((e) => e.type),
        },
      })
    }

    if (alertsToEmit.length > 0) {
      await emitAlerts(alertsToEmit)
    }

    // ── 6. Return structured result ───────────────────────────────────────────
    return {
      nurseId,
      facilityId: facilityId ?? null,
      pass,
      missing,
      expired,
      expiring,
    }
  }
}

// ── Nightly sweep helper — runs ComplianceGuardian for all active nurses ────────

export async function runNightlyComplianceSweep(): Promise<{
  nursesChecked: number
  passed: number
  failed: number
  warned: number
  errors: number
}> {
  const supabase = getAdminClient()
  const { AgentRunner } = await import('./core/AgentRunner')

  // Load all active nurses
  const { data: nurses, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'nurse')
    .eq('status', 'active')

  if (error) throw new Error(`Failed to load active nurses: ${error.message}`)

  const activeNurses = nurses ?? []
  const runner = new AgentRunner()
  runner.register(new ComplianceGuardian())

  let passed = 0, failed = 0, warned = 0, errors = 0

  for (const nurse of activeNurses) {
    const output = await runner.run({
      agentName: 'ComplianceGuardian',
      mode: 'nightly',
      nurseId: nurse.id,
    })

    if (!output.success) {
      errors++
      continue
    }

    const result = output.result as ComplianceGuardianResult
    if (result.pass) passed++
    else if (result.missing.some((m) => m.required) || result.expired.length > 0) failed++
    else warned++
  }

  return {
    nursesChecked: activeNurses.length,
    passed,
    failed,
    warned,
    errors,
  }
}
