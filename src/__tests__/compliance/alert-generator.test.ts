/**
 * Tests for Compliance Alert Generator (pure / no-DB version)
 */

import { generateAlertSpecs } from '@/lib/compliance/alert-generator'
import type { Credential } from '@/lib/compliance/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

const NURSE_ID = 'nurse-abc'
const FACILITY_ID = 'facility-xyz'

function makeDate(daysFromNow: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + daysFromNow)
  return d.toISOString().split('T')[0]
}

function makeCred(overrides: Partial<Credential> = {}): Credential {
  return {
    id: crypto.randomUUID(),
    nurse_id: NURSE_ID,
    facility_id: FACILITY_ID,
    type: 'RN_LICENSE',
    issuing_state: 'CA',
    number: '99999',
    status: 'active',
    expiration_date: makeDate(365),
    verified_at: null,
    verified_by: null,
    source: 'upload',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

const NO_REQUIRED: readonly string[] = []

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('generateAlertSpecs', () => {
  test('expired credential generates "expired" alert with critical severity', () => {
    const credentials = [
      makeCred({ type: 'RN_LICENSE', status: 'expired', expiration_date: makeDate(-15) }),
    ]
    const specs = generateAlertSpecs(credentials, NO_REQUIRED)

    expect(specs).toHaveLength(1)
    expect(specs[0].alert_type).toBe('expired')
    expect(specs[0].severity).toBe('critical')
    expect(specs[0].credential_id).toBeDefined()
    expect(specs[0].evidence).toMatchObject({
      type: 'RN_LICENSE',
    })
  })

  test('credential expiring in 5 days generates "expiring_7" alert with high severity', () => {
    const credentials = [
      makeCred({ type: 'ACLS', status: 'active', expiration_date: makeDate(5) }),
    ]
    const specs = generateAlertSpecs(credentials, NO_REQUIRED)

    expect(specs).toHaveLength(1)
    expect(specs[0].alert_type).toBe('expiring_7')
    expect(specs[0].severity).toBe('high')
    expect(specs[0].evidence).toMatchObject({ type: 'ACLS' })
    expect(Number(specs[0].evidence.days_until_expiry)).toBeLessThanOrEqual(7)
  })

  test('credential expiring in 25 days generates "expiring_30" alert with medium severity', () => {
    const credentials = [
      makeCred({ type: 'BLS', status: 'active', expiration_date: makeDate(25) }),
    ]
    const specs = generateAlertSpecs(credentials, NO_REQUIRED)

    expect(specs).toHaveLength(1)
    expect(specs[0].alert_type).toBe('expiring_30')
    expect(specs[0].severity).toBe('medium')
    expect(specs[0].evidence).toMatchObject({ type: 'BLS' })
    const days = Number(specs[0].evidence.days_until_expiry)
    expect(days).toBeGreaterThan(7)
    expect(days).toBeLessThanOrEqual(30)
  })

  test('missing required credential generates "missing_required" alert with critical severity', () => {
    const credentials: Credential[] = [] // no credentials at all
    const required = ['RN_LICENSE', 'BLS'] as const
    const specs = generateAlertSpecs(credentials, required)

    expect(specs).toHaveLength(2)
    expect(specs.every((s) => s.alert_type === 'missing_required')).toBe(true)
    expect(specs.every((s) => s.severity === 'critical')).toBe(true)
    const types = specs.map((s) => s.evidence.type)
    expect(types).toContain('RN_LICENSE')
    expect(types).toContain('BLS')
  })

  test('active credential far in future generates no alerts', () => {
    const credentials = [
      makeCred({ type: 'RN_LICENSE', status: 'active', expiration_date: makeDate(180) }),
    ]
    const specs = generateAlertSpecs(credentials, NO_REQUIRED)
    expect(specs).toHaveLength(0)
  })

  test('mixed credentials generate correct alert types', () => {
    const credentials = [
      makeCred({ type: 'RN_LICENSE', status: 'expired', expiration_date: makeDate(-5) }),
      makeCred({ type: 'BLS', status: 'active', expiration_date: makeDate(5) }),     // expiring_7
      makeCred({ type: 'PALS', status: 'active', expiration_date: makeDate(28) }),   // expiring_30
      makeCred({ type: 'ACLS', status: 'active', expiration_date: makeDate(100) }),  // fine
    ]
    const required = ['CPR'] as const
    const specs = generateAlertSpecs(credentials, required)

    const alertTypes = specs.map((s) => s.alert_type)
    expect(alertTypes).toContain('expired')
    expect(alertTypes).toContain('expiring_7')
    expect(alertTypes).toContain('expiring_30')
    expect(alertTypes).toContain('missing_required')
    // ACLS is fine (100d) — should NOT generate an alert
    const acls = specs.find((s) => s.evidence?.type === 'ACLS')
    expect(acls).toBeUndefined()
    // Should have exactly 4 alerts: expired, expiring_7, expiring_30, missing_required
    expect(specs).toHaveLength(4)
  })

  test('credential_id is included in evidence for credential-linked alerts', () => {
    const cred = makeCred({ type: 'BLS', status: 'active', expiration_date: makeDate(3) })
    const specs = generateAlertSpecs([cred], NO_REQUIRED)
    expect(specs[0].credential_id).toBe(cred.id)
    expect(specs[0].evidence.credential_id).toBe(cred.id)
  })
})
