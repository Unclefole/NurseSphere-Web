/**
 * Compliance Score Engine
 * Server-side only — uses service role client.
 *
 * Deduction schedule:
 *   expired:               -40 each (capped at -60 total)
 *   expiring_7:            -20 each (capped at -40 total)
 *   expiring_30:           -10 each (capped at -30 total)
 *   missing_required:      -30 each (uncapped — can zero the score)
 *   pending_verification:  -10 each (capped at -20 total)
 *
 * Final score clamped to [0, 100].
 */

import type { Credential, ComplianceScore, ScoreReason } from './types'
import { REQUIRED_CREDENTIAL_TYPES } from './types'

function daysBetween(dateStr: string): number {
  const exp = new Date(dateStr)
  const now = new Date()
  // Zero out time component for pure date comparison
  now.setHours(0, 0, 0, 0)
  exp.setHours(0, 0, 0, 0)
  return Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

/**
 * computeComplianceScore
 *
 * Pure function — no DB access. Pass pre-fetched credentials.
 * Returns {score, reasons, computed_at}.
 */
export function computeComplianceScore(
  _nurseId: string,
  _facilityId: string,
  credentials: Credential[],
  requiredTypes: readonly string[] = REQUIRED_CREDENTIAL_TYPES
): ComplianceScore {
  const reasons: ScoreReason[] = []
  let expiredDeduction = 0
  let expiring7Deduction = 0
  let expiring30Deduction = 0
  let pendingDeduction = 0
  let missingDeduction = 0

  const activeTypes = new Set(
    credentials
      .filter((c) => c.status === 'active' || c.status === 'expiring')
      .map((c) => c.type)
  )

  for (const cred of credentials) {
    const days = daysBetween(cred.expiration_date)

    if (cred.status === 'expired' || days < 0) {
      // Expired
      const deduction = 40
      expiredDeduction += deduction
      reasons.push({
        type: 'expired',
        credential_type: cred.type,
        credential_id: cred.id,
        deduction,
        detail: `${cred.type} expired ${Math.abs(days)} day(s) ago`,
      })
    } else if (days <= 7) {
      // Expiring within 7 days
      const deduction = 20
      expiring7Deduction += deduction
      reasons.push({
        type: 'expiring_7',
        credential_type: cred.type,
        credential_id: cred.id,
        deduction,
        detail: `${cred.type} expires in ${days} day(s)`,
      })
    } else if (days <= 30) {
      // Expiring within 30 days
      const deduction = 10
      expiring30Deduction += deduction
      reasons.push({
        type: 'expiring_30',
        credential_type: cred.type,
        credential_id: cred.id,
        deduction,
        detail: `${cred.type} expires in ${days} day(s)`,
      })
    } else if (cred.status === 'pending_verification') {
      const deduction = 10
      pendingDeduction += deduction
      reasons.push({
        type: 'pending_verification',
        credential_type: cred.type,
        credential_id: cred.id,
        deduction,
        detail: `${cred.type} awaiting verification`,
      })
    }
  }

  // Missing required credentials
  for (const reqType of requiredTypes) {
    if (!activeTypes.has(reqType)) {
      const deduction = 30
      missingDeduction += deduction
      reasons.push({
        type: 'missing_required',
        credential_type: reqType,
        deduction,
        detail: `Required credential ${reqType} is missing or not active`,
      })
    }
  }

  // Apply caps
  const cappedExpired = Math.min(expiredDeduction, 60)
  const cappedExpiring7 = Math.min(expiring7Deduction, 40)
  const cappedExpiring30 = Math.min(expiring30Deduction, 30)
  const cappedPending = Math.min(pendingDeduction, 20)
  // missing_required is uncapped by design

  const totalDeduction =
    cappedExpired + cappedExpiring7 + cappedExpiring30 + cappedPending + missingDeduction

  const score = Math.max(0, Math.min(100, 100 - totalDeduction))

  return {
    score,
    reasons,
    computed_at: new Date().toISOString(),
  }
}
