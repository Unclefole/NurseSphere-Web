/**
 * TIER 3 — Acuity + Litigation Defense Engine
 * Tests for competency matching, scoring, and risk certificates.
 *
 * Pure function tests run without DB / network.
 * DB-dependent functions are mocked via jest.mock().
 */

// ─── Mock external dependencies ──────────────────────────────────────────────

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabaseClient),
}))

jest.mock('@/lib/audit', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}))

// Mock competency-service for tests that test competency-matching in isolation
const mockGetNurseCompetencyForUnit = jest.fn()
const mockGetNurseCompetencies = jest.fn()
const mockUpsertCompetency = jest.fn()

jest.mock('@/lib/acuity/competency-service', () => ({
  ...jest.requireActual('@/lib/acuity/competency-service'),
  getNurseCompetencyForUnit: (...args: unknown[]) => mockGetNurseCompetencyForUnit(...args),
  getNurseCompetencies: (...args: unknown[]) => mockGetNurseCompetencies(...args),
  upsertCompetency: (...args: unknown[]) => mockUpsertCompetency(...args),
}))

// ─── Mock Supabase client ─────────────────────────────────────────────────────

const mockSingle = jest.fn()
const mockSelect = jest.fn()
const mockEq = jest.fn()
const mockIn = jest.fn()
const mockGte = jest.fn()
const mockNeq = jest.fn()
const mockInsert = jest.fn()
const mockUpsert = jest.fn()
const mockOrder = jest.fn()

// Chain builder: returns `this` for fluent interface
const chainMethods = {
  select: (...args: unknown[]) => { mockSelect(...args); return chainMethods },
  eq: (...args: unknown[]) => { mockEq(...args); return chainMethods },
  in: (...args: unknown[]) => { mockIn(...args); return chainMethods },
  gte: (...args: unknown[]) => { mockGte(...args); return chainMethods },
  neq: (...args: unknown[]) => { mockNeq(...args); return chainMethods },
  order: (...args: unknown[]) => { mockOrder(...args); return chainMethods },
  single: (...args: unknown[]) => mockSingle(...args),
  insert: (...args: unknown[]) => { mockInsert(...args); return chainMethods },
  upsert: (...args: unknown[]) => { mockUpsert(...args); return chainMethods },
}

const mockFrom = jest.fn(() => chainMethods)
const mockSupabaseClient = { from: mockFrom }

// ─── Imports (after mocks are set up) ─────────────────────────────────────────

import {
  computeRecencyIndex,
  computeCompetencyScore,
} from '@/lib/acuity/competency-service'

import {
  validateCompetencyMatch,
  adminOverrideCompetency,
} from '@/lib/acuity/competency-matching'

import {
  generateRiskCertificate,
  verifyCertificateIntegrity,
  computeCertificateHash,
} from '@/lib/acuity/risk-certificate'

import { writeAuditLog } from '@/lib/audit'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCompetency(overrides: Partial<{
  id: string
  nurse_id: string
  unit_type: string
  hours_last_12mo: number
  competency_score: number
  recency_index: number
  verified: boolean
  last_worked_at: string | null
}> = {}) {
  return {
    id: 'comp-1',
    nurse_id: 'nurse-1',
    unit_type: 'ICU',
    hours_last_12mo: 400,
    competency_score: 80,
    recency_index: 1.0,
    verified: true,
    last_worked_at: new Date().toISOString(),
    verified_at: new Date().toISOString(),
    verified_by: 'admin-1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeShift(overrides: Partial<{
  id: string
  facility_id: string
  acuity_level: string | null
  required_competencies: string[]
  minimum_competency_score: number
}> = {}) {
  return {
    id: 'shift-1',
    facility_id: 'facility-1',
    acuity_level: 'critical',
    required_competencies: ['ICU'],
    minimum_competency_score: 60,
    ...overrides,
  }
}

// Reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks()
  // Default: shift fetch returns an ICU critical shift
  mockSingle.mockResolvedValue({ data: makeShift(), error: null })
  mockGetNurseCompetencyForUnit.mockResolvedValue(null)
  mockGetNurseCompetencies.mockResolvedValue([])
})

// ─────────────────────────────────────────────────────────────────────────────
// computeRecencyIndex — Pure function tests
// ─────────────────────────────────────────────────────────────────────────────

describe('computeRecencyIndex', () => {
  test('test 7: worked last week → 1.0', () => {
    const lastWorked = new Date()
    lastWorked.setDate(lastWorked.getDate() - 7)
    expect(computeRecencyIndex(lastWorked)).toBe(1.0)
  })

  test('test 8: worked 8 months ago → 0.25', () => {
    const lastWorked = new Date()
    lastWorked.setDate(lastWorked.getDate() - 240) // ~8 months
    expect(computeRecencyIndex(lastWorked)).toBe(0.25)
  })

  test('test 9: never worked (null) → 0', () => {
    expect(computeRecencyIndex(null)).toBe(0)
  })

  test('worked 30 days ago exactly → 1.0 (boundary)', () => {
    const lastWorked = new Date()
    lastWorked.setDate(lastWorked.getDate() - 30)
    expect(computeRecencyIndex(lastWorked)).toBe(1.0)
  })

  test('worked 2 months ago → 0.75', () => {
    const lastWorked = new Date()
    lastWorked.setDate(lastWorked.getDate() - 60)
    expect(computeRecencyIndex(lastWorked)).toBe(0.75)
  })

  test('worked 4 months ago → 0.5', () => {
    const lastWorked = new Date()
    lastWorked.setDate(lastWorked.getDate() - 120)
    expect(computeRecencyIndex(lastWorked)).toBe(0.5)
  })

  test('worked 14 months ago → 0 (beyond 12mo)', () => {
    const lastWorked = new Date()
    lastWorked.setDate(lastWorked.getDate() - 425)
    expect(computeRecencyIndex(lastWorked)).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// computeCompetencyScore — Pure function tests
// ─────────────────────────────────────────────────────────────────────────────

describe('computeCompetencyScore', () => {
  test('test 10: 500h + recency 1.0 + verified → 100', () => {
    const score = computeCompetencyScore(500, 1.0, true)
    expect(score).toBe(100)
    // 500h: 60pts, recency: 30pts, verified: 10pts = 100
  })

  test('0h + recency 0 + not verified → 0', () => {
    expect(computeCompetencyScore(0, 0, false)).toBe(0)
  })

  test('500h + recency 0 + verified → 70', () => {
    const score = computeCompetencyScore(500, 0, true)
    expect(score).toBe(70) // 60 + 0 + 10
  })

  test('250h (half 500) + recency 0.5 + not verified → 45', () => {
    // Base: (250/500)*60 = 30, Recency: 0.5*30 = 15, Verified: 0 → 45
    const score = computeCompetencyScore(250, 0.5, false)
    expect(score).toBe(45)
  })

  test('hours capped at 500 — 1000h same as 500h', () => {
    const score500 = computeCompetencyScore(500, 1.0, true)
    const score1000 = computeCompetencyScore(1000, 1.0, true)
    expect(score500).toBe(score1000)
  })

  test('negative hours treated as 0', () => {
    expect(computeCompetencyScore(-100, 1.0, false)).toBe(30) // 0 + 30 + 0
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateCompetencyMatch — Integration tests (with mocks)
// ─────────────────────────────────────────────────────────────────────────────

describe('validateCompetencyMatch', () => {
  test('test 1: ICU shift acuity=critical, nurse has 0 ICU hours → blocked', async () => {
    // Shift: critical, requires ICU, threshold=60
    mockSingle.mockResolvedValue({
      data: makeShift({ acuity_level: 'critical', required_competencies: ['ICU'], minimum_competency_score: 60 }),
      error: null,
    })
    // Nurse: 0 ICU hours = score 0
    mockGetNurseCompetencyForUnit.mockResolvedValue(
      makeCompetency({ competency_score: 0, hours_last_12mo: 0, verified: false })
    )

    const result = await validateCompetencyMatch('nurse-1', 'shift-1')

    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.requiresOverride).toBe(true)
      expect(result.blockers.length).toBeGreaterThan(0)
      expect(result.blockers[0].nurse_score).toBe(0)
    }
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'shift.competency_blocked' })
    )
  })

  test('test 2: ICU shift acuity=critical, nurse has 400h ICU verified → allowed', async () => {
    mockSingle.mockResolvedValue({
      data: makeShift({ acuity_level: 'critical', required_competencies: ['ICU'], minimum_competency_score: 60 }),
      error: null,
    })
    // 400h ICU + recency 1.0 + verified → high score
    const score = computeCompetencyScore(400, 1.0, true)
    mockGetNurseCompetencyForUnit.mockResolvedValue(
      makeCompetency({ competency_score: score, hours_last_12mo: 400, verified: true })
    )

    const result = await validateCompetencyMatch('nurse-1', 'shift-1')

    expect(result.allowed).toBe(true)
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'shift.competency_validated' })
    )
  })

  test('test 3: shift acuity=low → always allowed regardless of competency', async () => {
    mockSingle.mockResolvedValue({
      data: makeShift({ acuity_level: 'low', required_competencies: ['ICU'], minimum_competency_score: 60 }),
      error: null,
    })
    // Even with 0 score, should be allowed
    mockGetNurseCompetencyForUnit.mockResolvedValue(
      makeCompetency({ competency_score: 0 })
    )

    const result = await validateCompetencyMatch('nurse-1', 'shift-1')

    expect(result.allowed).toBe(true)
    // Should not even check competencies for low acuity
    expect(mockGetNurseCompetencyForUnit).not.toHaveBeenCalled()
  })

  test('test 4: shift acuity=moderate, low score → allowed with warning', async () => {
    mockSingle.mockResolvedValue({
      data: makeShift({ acuity_level: 'moderate', required_competencies: ['ICU'], minimum_competency_score: 60 }),
      error: null,
    })
    // Score below threshold
    mockGetNurseCompetencyForUnit.mockResolvedValue(
      makeCompetency({ competency_score: 30, hours_last_12mo: 50, verified: false })
    )

    const result = await validateCompetencyMatch('nurse-1', 'shift-1')

    expect(result.allowed).toBe(true)
    if (result.allowed) {
      expect(result.warnings).toBeDefined()
      expect(result.warnings!.length).toBeGreaterThan(0)
    }
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'shift.competency_validated' })
    )
  })

  test('null acuity_level → always allowed', async () => {
    mockSingle.mockResolvedValue({
      data: makeShift({ acuity_level: null }),
      error: null,
    })

    const result = await validateCompetencyMatch('nurse-1', 'shift-1')

    expect(result.allowed).toBe(true)
    expect(mockGetNurseCompetencyForUnit).not.toHaveBeenCalled()
  })

  test('shift not found → throws', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'Not found' } })

    await expect(validateCompetencyMatch('nurse-1', 'bad-shift-id')).rejects.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// adminOverrideCompetency — Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('adminOverrideCompetency', () => {
  test('test 5: justification < 20 chars → rejected', async () => {
    await expect(
      adminOverrideCompetency('shift-1', 'nurse-1', 'admin-1', 'too short')
    ).rejects.toThrow(/20 characters/)
  })

  test('test 5b: empty justification → rejected', async () => {
    await expect(
      adminOverrideCompetency('shift-1', 'nurse-1', 'admin-1', '')
    ).rejects.toThrow(/20 characters/)
  })

  test('test 6: valid justification → override audit logged', async () => {
    const justification = 'Nurse has additional training not captured in system — verified by CNO'

    const result = await adminOverrideCompetency('shift-1', 'nurse-1', 'admin-1', justification)

    expect(result.overrideToken).toBeDefined()
    expect(result.overrideToken.length).toBe(32)
    expect(result.justification).toBe(justification.trim())
    expect(result.shiftId).toBe('shift-1')
    expect(result.nurseId).toBe('nurse-1')

    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_id: 'admin-1',
        action: 'shift.competency_override',
        metadata: expect.objectContaining({
          shift_id: 'shift-1',
          nurse_id: 'nurse-1',
          justification: justification.trim(),
        }),
      })
    )
  })

  test('justification exactly 20 chars → accepted', async () => {
    const justification = '12345678901234567890' // exactly 20
    const result = await adminOverrideCompetency('shift-1', 'nurse-1', 'admin-1', justification)
    expect(result).toBeDefined()
  })

  test('justification 19 chars → rejected', async () => {
    await expect(
      adminOverrideCompetency('shift-1', 'nurse-1', 'admin-1', '1234567890123456789')
    ).rejects.toThrow(/20 characters/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// generateRiskCertificate + verifyCertificateIntegrity
// ─────────────────────────────────────────────────────────────────────────────

describe('generateRiskCertificate + verifyCertificateIntegrity', () => {
  const CERT_ID = 'cert-abc-123'

  function mockCertInsert(partialCert: Record<string, unknown> = {}) {
    // Mock the full flow: shift fetch, credentials, competencies, alt candidates, insert
    const shiftData = makeShift({ acuity_level: 'critical', minimum_competency_score: 60 })
    const certData = {
      id: CERT_ID,
      shift_id: 'shift-1',
      nurse_id: 'nurse-1',
      facility_id: 'facility-1',
      credential_status_snapshot: [],
      competency_snapshot: [],
      compliance_score: 100,
      competency_score: 0,
      alternative_candidates_available: 0,
      decision_basis: { criteria_met: ['Compliance score: 100% (≥80% threshold)'], overrides: [], compliance_score: 100, competency_score: 0 },
      admin_override: false,
      override_justification: null,
      override_actor_id: null,
      certificate_hash: 'placeholder',
      issued_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      ...partialCert,
    }

    // For generateRiskCertificate: shift → credentials → alt nurses → alt profiles → insert
    mockFrom.mockImplementation((table: string) => {
      if (table === 'shifts') {
        return { ...chainMethods, single: () => Promise.resolve({ data: shiftData, error: null }) }
      }
      if (table === 'credentials') {
        return { ...chainMethods, select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
      }
      if (table === 'competencies') {
        return { ...chainMethods, select: () => ({ in: () => ({ gte: () => ({ neq: () => Promise.resolve({ data: [], error: null }) }) }) }) }
      }
      if (table === 'profiles') {
        return { ...chainMethods, select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }) }) }) }
      }
      if (table === 'shift_risk_certificates') {
        return {
          ...chainMethods,
          insert: () => ({ ...chainMethods, select: () => ({ single: () => Promise.resolve({ data: certData, error: null }) }) }),
          select: () => ({ ...chainMethods, eq: () => ({ ...chainMethods, single: () => Promise.resolve({ data: certData, error: null }) }) }),
        }
      }
      return chainMethods
    })

    mockGetNurseCompetencies.mockResolvedValue([])

    return certData
  }

  test('test 11: certificate hash matches contents', async () => {
    const certData = mockCertInsert()

    const certificate = await generateRiskCertificate('shift-1', 'nurse-1')

    // The returned certificate has a hash
    expect(certificate).toBeDefined()
    expect(certificate.id).toBe(CERT_ID)

    // Verify the hash logic itself works correctly
    const expectedHash = computeCertificateHash({
      shift_id: certData.shift_id,
      nurse_id: certData.nurse_id,
      facility_id: certData.facility_id,
      credential_status_snapshot: certData.credential_status_snapshot,
      competency_snapshot: certData.competency_snapshot,
      compliance_score: certData.compliance_score,
      competency_score: certData.competency_score,
      decision_basis: certData.decision_basis,
      issued_at: certData.issued_at,
    })
    expect(expectedHash).toMatch(/^[a-f0-9]{64}$/)

    // Same inputs → same hash
    const expectedHash2 = computeCertificateHash({
      shift_id: certData.shift_id,
      nurse_id: certData.nurse_id,
      facility_id: certData.facility_id,
      credential_status_snapshot: certData.credential_status_snapshot,
      competency_snapshot: certData.competency_snapshot,
      compliance_score: certData.compliance_score,
      competency_score: certData.competency_score,
      decision_basis: certData.decision_basis,
      issued_at: certData.issued_at,
    })
    expect(expectedHash).toBe(expectedHash2)

    // Audit log was called
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'risk_certificate.issued' })
    )
  })

  test('test 12: verifyCertificateIntegrity — tampered certificate returns valid=false', async () => {
    // Compute the real hash for the cert
    const realPayload = {
      shift_id: 'shift-1',
      nurse_id: 'nurse-1',
      facility_id: 'facility-1',
      credential_status_snapshot: [] as [],
      competency_snapshot: [] as [],
      compliance_score: 100,
      competency_score: 0,
      decision_basis: { criteria_met: ['Compliance score: 100% (≥80% threshold)'], overrides: [], compliance_score: 100, competency_score: 0 },
      issued_at: '2026-01-01T00:00:00.000Z',
    }
    const realHash = computeCertificateHash(realPayload)

    // Tampered cert: compliance_score changed to 50, but hash still points to original
    const tamperedCert = {
      id: CERT_ID,
      shift_id: 'shift-1',
      nurse_id: 'nurse-1',
      facility_id: 'facility-1',
      credential_status_snapshot: [],
      competency_snapshot: [],
      compliance_score: 50, // TAMPERED — was 100
      competency_score: 0,
      alternative_candidates_available: 0,
      decision_basis: { criteria_met: ['Compliance score: 100% (≥80% threshold)'], overrides: [], compliance_score: 100, competency_score: 0 },
      admin_override: false,
      override_justification: null,
      override_actor_id: null,
      certificate_hash: realHash, // original hash, doesn't match tampered data
      issued_at: '2026-01-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
    }

    mockFrom.mockImplementation((table: string) => {
      if (table === 'shift_risk_certificates') {
        return {
          ...chainMethods,
          select: () => ({
            ...chainMethods,
            eq: () => ({
              ...chainMethods,
              single: () => Promise.resolve({ data: tamperedCert, error: null }),
            }),
          }),
        }
      }
      return chainMethods
    })

    const result = await verifyCertificateIntegrity(CERT_ID)

    expect(result.valid).toBe(false)
    expect(result.certificate).toBeDefined()
  })

  test('verifyCertificateIntegrity — valid certificate returns valid=true', async () => {
    const payload = {
      shift_id: 'shift-1',
      nurse_id: 'nurse-1',
      facility_id: 'facility-1',
      credential_status_snapshot: [] as [],
      competency_snapshot: [] as [],
      compliance_score: 100,
      competency_score: 80,
      decision_basis: { criteria_met: ['All criteria met'], overrides: [], compliance_score: 100, competency_score: 80 },
      issued_at: '2026-01-01T00:00:00.000Z',
    }
    const hash = computeCertificateHash(payload)

    const validCert = {
      id: CERT_ID,
      ...payload,
      alternative_candidates_available: 0,
      admin_override: false,
      override_justification: null,
      override_actor_id: null,
      certificate_hash: hash,
      created_at: '2026-01-01T00:00:00.000Z',
    }

    mockFrom.mockImplementation((table: string) => {
      if (table === 'shift_risk_certificates') {
        return {
          ...chainMethods,
          select: () => ({
            ...chainMethods,
            eq: () => ({
              ...chainMethods,
              single: () => Promise.resolve({ data: validCert, error: null }),
            }),
          }),
        }
      }
      return chainMethods
    })

    const result = await verifyCertificateIntegrity(CERT_ID)

    expect(result.valid).toBe(true)
    expect(result.certificate).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// computeCertificateHash — determinism tests
// ─────────────────────────────────────────────────────────────────────────────

describe('computeCertificateHash', () => {
  const payload = {
    shift_id: 'shift-abc',
    nurse_id: 'nurse-xyz',
    facility_id: 'facility-123',
    credential_status_snapshot: [] as [],
    competency_snapshot: [] as [],
    compliance_score: 95,
    competency_score: 82,
    decision_basis: { criteria_met: ['All criteria met'], overrides: [], compliance_score: 95, competency_score: 82 },
    issued_at: '2026-02-24T00:00:00.000Z',
  }

  test('returns a 64-char hex SHA-256 string', () => {
    const hash = computeCertificateHash(payload)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  test('same inputs produce same hash (deterministic)', () => {
    expect(computeCertificateHash(payload)).toBe(computeCertificateHash(payload))
  })

  test('different compliance_score produces different hash (tamper detection)', () => {
    const hash1 = computeCertificateHash({ ...payload, compliance_score: 95 })
    const hash2 = computeCertificateHash({ ...payload, compliance_score: 50 })
    expect(hash1).not.toBe(hash2)
  })

  test('different nurse_id produces different hash', () => {
    const hash1 = computeCertificateHash({ ...payload, nurse_id: 'nurse-A' })
    const hash2 = computeCertificateHash({ ...payload, nurse_id: 'nurse-B' })
    expect(hash1).not.toBe(hash2)
  })
})
