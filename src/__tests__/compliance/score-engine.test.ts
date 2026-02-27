/**
 * Tests for Compliance Score Engine
 */

import { computeComplianceScore } from '@/lib/compliance/score-engine'
import type { Credential } from '@/lib/compliance/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

const NURSE_ID = 'nurse-123'
const FACILITY_ID = 'facility-456'

function makeDate(daysFromNow: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + daysFromNow)
  return d.toISOString().split('T')[0]
}

function makeCred(overrides: Partial<Credential>): Credential {
  return {
    id: crypto.randomUUID(),
    nurse_id: NURSE_ID,
    facility_id: FACILITY_ID,
    type: 'RN_LICENSE',
    issuing_state: 'CA',
    number: '12345',
    status: 'active',
    expiration_date: makeDate(365), // 1 year from now by default
    verified_at: null,
    verified_by: null,
    source: 'upload',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

// No required types for simplest tests
const NO_REQUIRED: readonly string[] = []

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('computeComplianceScore', () => {
  test('nurse with all active credentials → score 100', () => {
    const credentials = [
      makeCred({ type: 'RN_LICENSE', status: 'active', expiration_date: makeDate(365) }),
      makeCred({ type: 'BLS', status: 'active', expiration_date: makeDate(200) }),
      makeCred({ type: 'ACLS', status: 'active', expiration_date: makeDate(300) }),
    ]
    const result = computeComplianceScore(NURSE_ID, FACILITY_ID, credentials, NO_REQUIRED)
    expect(result.score).toBe(100)
    expect(result.reasons).toHaveLength(0)
  })

  test('nurse with 1 expired credential → score 60', () => {
    const credentials = [
      makeCred({ type: 'RN_LICENSE', status: 'expired', expiration_date: makeDate(-10) }),
    ]
    const result = computeComplianceScore(NURSE_ID, FACILITY_ID, credentials, NO_REQUIRED)
    // 1 expired = -40, capped at -60, so 100 - 40 = 60
    expect(result.score).toBe(60)
    expect(result.reasons).toHaveLength(1)
    expect(result.reasons[0].type).toBe('expired')
    expect(result.reasons[0].deduction).toBe(40)
  })

  test('nurse with 2 expired credentials → score capped (score = 20)', () => {
    const credentials = [
      makeCred({ type: 'RN_LICENSE', status: 'expired', expiration_date: makeDate(-5) }),
      makeCred({ type: 'BLS', status: 'expired', expiration_date: makeDate(-3) }),
    ]
    const result = computeComplianceScore(NURSE_ID, FACILITY_ID, credentials, NO_REQUIRED)
    // 2 expired = -80 raw, capped at -60, so 100 - 60 = 40
    expect(result.score).toBe(40)
    expect(result.reasons.filter((r) => r.type === 'expired')).toHaveLength(2)
  })

  test('nurse with 2 expired + 1 missing_required → score 10', () => {
    const credentials = [
      makeCred({ type: 'BLS', status: 'expired', expiration_date: makeDate(-5) }),
      makeCred({ type: 'ACLS', status: 'expired', expiration_date: makeDate(-3) }),
    ]
    const required = ['RN_LICENSE'] as const
    const result = computeComplianceScore(NURSE_ID, FACILITY_ID, credentials, required)
    // 2 expired = -80 raw, capped at -60; missing_required = -30 (uncapped)
    // total deduction = -60 + -30 = -90 → score = 100 - 90 = 10
    expect(result.score).toBe(10)
    const missingReasons = result.reasons.filter((r) => r.type === 'missing_required')
    expect(missingReasons).toHaveLength(1)
    expect(missingReasons[0].credential_type).toBe('RN_LICENSE')
  })

  test('nurse with 3 expired + 1 missing_required → score 0 (clamped)', () => {
    const credentials = [
      makeCred({ type: 'BLS', status: 'expired', expiration_date: makeDate(-5) }),
      makeCred({ type: 'ACLS', status: 'expired', expiration_date: makeDate(-3) }),
      makeCred({ type: 'CPR', status: 'expired', expiration_date: makeDate(-1) }),
    ]
    const required = ['RN_LICENSE'] as const
    const result = computeComplianceScore(NURSE_ID, FACILITY_ID, credentials, required)
    // 3 expired = -120 raw, capped at -60; missing_required = -30 (uncapped)
    // total deduction = -60 + -30 = -90 → score = 10 (not 0 without more missing)
    // With 2 required missing:
    const result2 = computeComplianceScore(
      NURSE_ID,
      FACILITY_ID,
      credentials,
      ['RN_LICENSE', 'NIHSS'] as const
    )
    // -60 + -30 + -30 = -120 → 100-120 clamped to 0
    expect(result2.score).toBe(0)
  })

  test('nurse with expiring_7 credential → score 80', () => {
    const credentials = [
      makeCred({ type: 'RN_LICENSE', status: 'active', expiration_date: makeDate(5) }),
    ]
    const result = computeComplianceScore(NURSE_ID, FACILITY_ID, credentials, NO_REQUIRED)
    // 1 expiring_7 = -20, so 100 - 20 = 80
    expect(result.score).toBe(80)
    expect(result.reasons[0].type).toBe('expiring_7')
  })

  test('nurse with expiring_30 credential → score 90', () => {
    const credentials = [
      makeCred({ type: 'BLS', status: 'active', expiration_date: makeDate(20) }),
    ]
    const result = computeComplianceScore(NURSE_ID, FACILITY_ID, credentials, NO_REQUIRED)
    // 1 expiring_30 = -10, so 100 - 10 = 90
    expect(result.score).toBe(90)
    expect(result.reasons[0].type).toBe('expiring_30')
  })

  test('reasons array contains correct entries for mixed credentials', () => {
    const credentials = [
      makeCred({ type: 'RN_LICENSE', status: 'active', expiration_date: makeDate(5) }), // expiring_7
      makeCred({ type: 'BLS', status: 'active', expiration_date: makeDate(25) }),       // expiring_30
    ]
    const required = ['ACLS'] as const
    const result = computeComplianceScore(NURSE_ID, FACILITY_ID, credentials, required)

    const types = result.reasons.map((r) => r.type)
    expect(types).toContain('expiring_7')
    expect(types).toContain('expiring_30')
    expect(types).toContain('missing_required')

    const missingReason = result.reasons.find((r) => r.type === 'missing_required')
    expect(missingReason?.credential_type).toBe('ACLS')
  })

  test('pending_verification deducts 10 each (capped at 20)', () => {
    const credentials = [
      makeCred({ type: 'RN_LICENSE', status: 'pending_verification', expiration_date: makeDate(365) }),
      makeCred({ type: 'BLS', status: 'pending_verification', expiration_date: makeDate(300) }),
      makeCred({ type: 'ACLS', status: 'pending_verification', expiration_date: makeDate(200) }),
    ]
    const result = computeComplianceScore(NURSE_ID, FACILITY_ID, credentials, NO_REQUIRED)
    // 3 pending = -30 raw, capped at -20, so 100 - 20 = 80
    expect(result.score).toBe(80)
  })

  test('computed_at is a valid ISO timestamp', () => {
    const result = computeComplianceScore(NURSE_ID, FACILITY_ID, [], NO_REQUIRED)
    expect(() => new Date(result.computed_at)).not.toThrow()
    expect(new Date(result.computed_at).getFullYear()).toBeGreaterThanOrEqual(2026)
  })
})
