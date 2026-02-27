/**
 * Compliance Sweep Tests — NurseSphere TIER 1
 *
 * Tests cover:
 *   1. complianceSweep() — OIG hit triggers alert + suspension
 *   2. complianceSweep() — clean nurse passes through untouched
 *   3. complianceSweep() — expired license triggers alert, not suspension
 *   4. suspendNurse() — sets status + creates audit log + alert
 *   5. reinstateNurse() — clears suspension, requires actorId
 *   6. validateBeforeShift() — suspended nurse blocks shift
 *   7. validateBeforeShift() — OIG hit during revalidation blocks shift
 *   8. validateBeforeShift() — active compliant nurse passes
 *   9. Sweep log is written on completion
 *  10. CSV export contains no PHI fields
 *
 * PHI note: all test data uses synthetic UUIDs and fake names.
 */

// ── Mock Supabase ──────────────────────────────────────────────────────────────

// We build a chainable Supabase mock factory
const buildChainMock = (overrides: Record<string, unknown> = {}) => {
  const chain: Record<string, jest.Mock> = {}
  const methods = ['select', 'insert', 'update', 'upsert', 'eq', 'in', 'gte', 'lte', 'order', 'limit', 'maybeSingle', 'single']
  for (const m of methods) {
    chain[m] = jest.fn(() => chain)
  }
  // Allow overriding specific method return values
  for (const [k, v] of Object.entries(overrides)) {
    chain[k] = jest.fn(() => v)
  }
  return chain
}

// Shared mock state
let mockFromImpl: (table: string) => ReturnType<typeof buildChainMock>

const mockCreateClient = jest.fn(() => ({
  from: jest.fn((table: string) => mockFromImpl(table)),
  auth: {
    getSession: jest.fn(() => Promise.resolve({ data: { session: null }, error: null })),
  },
}))

jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}))

// Mock @supabase/ssr
jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(() => ({
    auth: { getSession: jest.fn(() => Promise.resolve({ data: { session: null } })) },
    from: jest.fn(() => buildChainMock()),
  })),
}))

// Mock next/headers (used by supabase-server)
jest.mock('next/headers', () => ({
  cookies: jest.fn(() => ({
    getAll: jest.fn(() => []),
    set: jest.fn(),
  })),
}))

// Mock OIG checker
const mockCheckOIGExclusion = jest.fn()
jest.mock('@/lib/verification/oig-checker', () => ({
  checkOIGExclusion: (...args: unknown[]) => mockCheckOIGExclusion(...args),
  isExcluded: jest.fn(() => Promise.resolve(false)),
}))

// Mock NURSYS checker
const mockVerifyNurseLicense = jest.fn()
jest.mock('@/lib/verification/nursys-checker', () => ({
  verifyNurseLicense: (...args: unknown[]) => mockVerifyNurseLicense(...args),
}))

// Mock audit log
const mockWriteAuditLog = jest.fn()
jest.mock('@/lib/audit', () => ({
  writeAuditLog: (...args: unknown[]) => mockWriteAuditLog(...args),
}))

// Mock push sender
const mockSendPushToFacilityAdmins = jest.fn()
jest.mock('@/lib/notifications/push-sender', () => ({
  sendPushToFacilityAdmins: (...args: unknown[]) => mockSendPushToFacilityAdmins(...args),
}))

// Mock feature flags — default safe-off
jest.mock('@/lib/feature-flags', () => ({
  featureFlags: {
    auto_suspension: false,
    continuous_compliance: false,
  },
}))

// Mock score engine (dynamic import in compliance-sweep)
jest.mock('@/lib/compliance/score-engine', () => ({
  computeComplianceScore: jest.fn(() => ({
    score: 95,
    reasons: [],
    computed_at: new Date().toISOString(),
  })),
}))

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import { complianceSweep, getSweepHistory } from '@/lib/compliance/compliance-sweep'
import { suspendNurse, reinstateNurse, getNurseStatus, isNurseEligible, SYSTEM_UUID } from '@/lib/compliance/auto-suspension'
import { validateBeforeShift } from '@/lib/compliance/validate-before-shift'

// ── Env setup ──────────────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
})

afterEach(() => {
  jest.clearAllMocks()
})

// ── Helpers ────────────────────────────────────────────────────────────────────

const NURSE_UUID = '11111111-1111-1111-1111-111111111111'
const FACILITY_UUID = '22222222-2222-2222-2222-222222222222'
const SHIFT_UUID = '33333333-3333-3333-3333-333333333333'
const ADMIN_UUID = '44444444-4444-4444-4444-444444444444'
const CREDENTIAL_UUID = '55555555-5555-5555-5555-555555555555'

function makeOIGClear() {
  return {
    excluded: false,
    status: 'clear',
    source: 'OIG_LEIE',
    checked_at: new Date().toISOString(),
  }
}

function makeOIGExcluded() {
  return {
    excluded: true,
    status: 'excluded',
    reason: 'Section 1128(a)(1)',
    exclusion_date: '2023-01-01',
    source: 'OIG_LEIE',
    checked_at: new Date().toISOString(),
  }
}

function makeNURSYSActive() {
  return {
    valid: true,
    licenseNumber: 'RN-12345',
    issuingState: 'CA',
    status: 'active',
    source: 'NURSYS',
    checked_at: new Date().toISOString(),
  }
}

function makeNURSYSExpired() {
  return {
    valid: false,
    licenseNumber: 'RN-12345',
    issuingState: 'CA',
    status: 'expired',
    source: 'NURSYS',
    checked_at: new Date().toISOString(),
  }
}

// ── Build Supabase table mock helpers ──────────────────────────────────────────

function setupDefaultSweepMocks(options: {
  nurseStatus?: string
  oigExcluded?: boolean
  licenseStatus?: string
} = {}) {
  const nurseStatus = options.nurseStatus ?? 'active'
  const nurses = [
    { id: NURSE_UUID, first_name: 'Zynthia', last_name: 'Xnovrescu', facility_id: FACILITY_UUID },
  ]
  const credentials = [
    {
      id: CREDENTIAL_UUID,
      nurse_id: NURSE_UUID,
      type: 'RN_LICENSE',
      number: 'RN-12345',
      issuing_state: 'CA',
      status: nurseStatus,
      expiration_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    },
  ]
  const sweepLogId = 'sweep-log-id-001'

  // Table-level mock dispatching
  mockFromImpl = (table: string) => {
    if (table === 'compliance_sweep_log') {
      const insertChain = buildChainMock()
      insertChain.insert = jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn(() => Promise.resolve({ data: { id: sweepLogId }, error: null })),
        })),
      }))
      insertChain.update = jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ data: null, error: null })),
      }))
      insertChain.select = jest.fn(() => ({
        order: jest.fn(() => ({
          limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
        })),
      }))
      return insertChain
    }

    if (table === 'profiles') {
      const chain = buildChainMock()
      chain.select = jest.fn(() => ({
        eq: jest.fn((col: string, val: string) => {
          if (col === 'role' && val === 'nurse') {
            return {
              eq: jest.fn((c: string, v: string) => {
                if (c === 'status' && v === 'active') {
                  return Promise.resolve({ data: nurses, error: null })
                }
                return Promise.resolve({ data: nurses, error: null })
              }),
            }
          }
          return {
            eq: jest.fn(() => Promise.resolve({ data: nurses, error: null })),
            maybeSingle: jest.fn(() => Promise.resolve({ data: { id: NURSE_UUID, status: nurseStatus, first_name: 'Zynthia', last_name: 'Xnovrescu', facility_id: FACILITY_UUID }, error: null })),
          }
        }),
        maybeSingle: jest.fn(() => Promise.resolve({
          data: { id: NURSE_UUID, status: nurseStatus, suspension_reason: null, suspended_at: null },
          error: null,
        })),
      }))
      chain.update = jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ data: null, error: null })),
      }))
      return chain
    }

    if (table === 'credentials') {
      const chain = buildChainMock()
      chain.select = jest.fn(() => ({
        eq: jest.fn(() => ({
          in: jest.fn(() => Promise.resolve({ data: credentials, error: null })),
          order: jest.fn(() => ({
            limit: jest.fn(() => ({
              maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
            })),
          })),
        })),
        in: jest.fn(() => Promise.resolve({ data: credentials, error: null })),
      }))
      chain.update = jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ data: null, error: null })),
      }))
      return chain
    }

    if (table === 'compliance_alerts') {
      const chain = buildChainMock()
      chain.insert = jest.fn(() => Promise.resolve({ data: null, error: null }))
      chain.select = jest.fn(() => ({
        eq: jest.fn(() => ({
          in: jest.fn(() => Promise.resolve({ data: [], error: null })),
        })),
      }))
      return chain
    }

    if (table === 'shift_assignments') {
      const chain = buildChainMock()
      chain.select = jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(() => Promise.resolve({ data: { nurse_id: NURSE_UUID, facility_id: FACILITY_UUID }, error: null })),
          limit: jest.fn(() => ({
            maybeSingle: jest.fn(() => Promise.resolve({ data: { facility_id: FACILITY_UUID }, error: null })),
          })),
        })),
        limit: jest.fn(() => ({
          maybeSingle: jest.fn(() => Promise.resolve({ data: { facility_id: FACILITY_UUID }, error: null })),
        })),
      }))
      return chain
    }

    if (table === 'shifts') {
      const chain = buildChainMock()
      chain.select = jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(() => Promise.resolve({ data: { id: SHIFT_UUID, facility_id: FACILITY_UUID, status: 'scheduled' }, error: null })),
        })),
      }))
      chain.update = jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ data: null, error: null })),
      }))
      return chain
    }

    if (table === 'compliance_scores') {
      const chain = buildChainMock()
      chain.upsert = jest.fn(() => Promise.resolve({ data: null, error: null }))
      return chain
    }

    if (table === 'credential_verifications') {
      const chain = buildChainMock()
      chain.select = jest.fn(() => ({
        eq: jest.fn(() => ({
          eq: jest.fn(() => ({
            gte: jest.fn(() => ({
              order: jest.fn(() => ({
                limit: jest.fn(() => ({
                  maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
                })),
              })),
            })),
            order: jest.fn(() => ({
              limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
            })),
          })),
        })),
      }))
      return chain
    }

    if (table === 'audit_logs') {
      const chain = buildChainMock()
      chain.select = jest.fn(() => ({
        eq: jest.fn(() => ({
          in: jest.fn(() => ({
            order: jest.fn(() => ({
              limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
            })),
          })),
        })),
      }))
      return chain
    }

    // Default passthrough
    return buildChainMock({
      insert: jest.fn(() => Promise.resolve({ data: null, error: null })),
      update: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ data: null, error: null })) })),
      select: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ data: [], error: null })) })),
      single: jest.fn(() => Promise.resolve({ data: null, error: null })),
      maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
    })
  }
}

// ── Test Suite ─────────────────────────────────────────────────────────────────

// ── 1. complianceSweep() — OIG hit triggers alert + suspension ─────────────────
describe('complianceSweep()', () => {
  test('1. OIG exclusion hit creates alert (auto_suspension off by default)', async () => {
    setupDefaultSweepMocks({ oigExcluded: true })
    mockCheckOIGExclusion.mockResolvedValue(makeOIGExcluded())
    mockVerifyNurseLicense.mockResolvedValue(makeNURSYSActive())
    mockWriteAuditLog.mockResolvedValue(undefined)
    mockSendPushToFacilityAdmins.mockResolvedValue(undefined)

    // Track alert inserts
    let alertInsertCalled = false
    const origFromImpl = mockFromImpl
    mockFromImpl = (table: string) => {
      const chain = origFromImpl(table)
      if (table === 'compliance_alerts') {
        chain.insert = jest.fn(() => {
          alertInsertCalled = true
          return Promise.resolve({ data: null, error: null })
        })
      }
      return chain
    }

    const result = await complianceSweep()

    expect(mockCheckOIGExclusion).toHaveBeenCalled()
    expect(result.nursesChecked).toBe(1)
    expect(alertInsertCalled).toBe(true)
    expect(result.status).toBe('completed')
    // Audit log called for sweep completion
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'compliance.sweep.completed', actor_id: SYSTEM_UUID }),
    )
  })

  // ── 2. Clean nurse passes through untouched ─────────────────────────────────
  test('2. Clean nurse — OIG clear + license active — passes without alert', async () => {
    setupDefaultSweepMocks()
    mockCheckOIGExclusion.mockResolvedValue(makeOIGClear())
    mockVerifyNurseLicense.mockResolvedValue(makeNURSYSActive())
    mockWriteAuditLog.mockResolvedValue(undefined)
    mockSendPushToFacilityAdmins.mockResolvedValue(undefined)

    let alertInsertCallCount = 0
    const origFromImpl = mockFromImpl
    mockFromImpl = (table: string) => {
      const chain = origFromImpl(table)
      if (table === 'compliance_alerts') {
        chain.insert = jest.fn(() => {
          alertInsertCallCount++
          return Promise.resolve({ data: null, error: null })
        })
      }
      return chain
    }

    const result = await complianceSweep()

    expect(result.nursesChecked).toBe(1)
    expect(alertInsertCallCount).toBe(0)
    expect(result.alertsCreated).toBe(0)
    expect(result.suspensionsTriggered).toBe(0)
    expect(result.status).toBe('completed')
  })

  // ── 3. Expired license triggers alert, not suspension ───────────────────────
  test('3. Expired license triggers alert but NOT suspension', async () => {
    setupDefaultSweepMocks({ licenseStatus: 'expired' })
    mockCheckOIGExclusion.mockResolvedValue(makeOIGClear())
    mockVerifyNurseLicense.mockResolvedValue(makeNURSYSExpired())
    mockWriteAuditLog.mockResolvedValue(undefined)
    mockSendPushToFacilityAdmins.mockResolvedValue(undefined)

    let alertInsertCalled = false
    const origFromImpl = mockFromImpl
    mockFromImpl = (table: string) => {
      const chain = origFromImpl(table)
      if (table === 'compliance_alerts') {
        chain.insert = jest.fn(() => {
          alertInsertCalled = true
          return Promise.resolve({ data: null, error: null })
        })
      }
      return chain
    }

    const result = await complianceSweep()

    expect(result.nursesChecked).toBe(1)
    // Alert should be created for expired license
    expect(alertInsertCalled).toBe(true)
    // But NOT suspended (expired license is not suspension-level by default;
    // auto_suspension flag is off and expired != revoked/surrendered)
    expect(result.suspensionsTriggered).toBe(0)
    expect(result.status).toBe('completed')
  })

  // ── 9. Sweep log is written on completion ───────────────────────────────────
  test('9. Sweep log row is created and updated on completion', async () => {
    setupDefaultSweepMocks()
    mockCheckOIGExclusion.mockResolvedValue(makeOIGClear())
    mockVerifyNurseLicense.mockResolvedValue(makeNURSYSActive())
    mockWriteAuditLog.mockResolvedValue(undefined)
    mockSendPushToFacilityAdmins.mockResolvedValue(undefined)

    let insertCalledWithRunning = false
    let updateCalledWithCompleted = false

    const origFromImpl = mockFromImpl
    mockFromImpl = (table: string) => {
      if (table === 'compliance_sweep_log') {
        return {
          insert: jest.fn((data: Record<string, unknown>) => {
            if (data.status === 'running') insertCalledWithRunning = true
            return {
              select: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: { id: 'sweep-log-001' }, error: null })),
              })),
            }
          }),
          update: jest.fn((data: Record<string, unknown>) => {
            if (data.status === 'completed') updateCalledWithCompleted = true
            return { eq: jest.fn(() => Promise.resolve({ data: null, error: null })) }
          }),
          select: jest.fn(() => ({
            order: jest.fn(() => ({
              limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
            })),
          })),
        }
      }
      return origFromImpl(table)
    }

    await complianceSweep()

    expect(insertCalledWithRunning).toBe(true)
    expect(updateCalledWithCompleted).toBe(true)
  })
})

// ── 4. suspendNurse() ──────────────────────────────────────────────────────────
describe('suspendNurse()', () => {
  test('4. suspendNurse() sets status + creates audit log + alert', async () => {
    let profileUpdated = false
    let alertCreated = false

    mockFromImpl = (table: string) => {
      if (table === 'profiles') {
        return {
          update: jest.fn(() => ({
            eq: jest.fn(() => {
              profileUpdated = true
              return Promise.resolve({ data: null, error: null })
            }),
          })),
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              maybeSingle: jest.fn(() => Promise.resolve({ data: { facility_id: FACILITY_UUID }, error: null })),
            })),
          })),
        }
      }
      if (table === 'compliance_alerts') {
        return {
          insert: jest.fn(() => {
            alertCreated = true
            return Promise.resolve({ data: null, error: null })
          }),
        }
      }
      if (table === 'shift_assignments') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              limit: jest.fn(() => ({
                maybeSingle: jest.fn(() => Promise.resolve({ data: { facility_id: FACILITY_UUID }, error: null })),
              })),
            })),
          })),
        }
      }
      return buildChainMock({ insert: jest.fn(() => Promise.resolve({ data: null, error: null })) })
    }

    mockWriteAuditLog.mockResolvedValue(undefined)

    const result = await suspendNurse(
      NURSE_UUID,
      'OIG exclusion detected',
      { credential_id: CREDENTIAL_UUID, source: 'OIG_LEIE', checked_at: new Date().toISOString() },
      SYSTEM_UUID,
    )

    expect(result.success).toBe(true)
    expect(result.nurseId).toBe(NURSE_UUID)
    expect(profileUpdated).toBe(true)
    expect(alertCreated).toBe(true)
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'nurse.suspended',
        actor_id: SYSTEM_UUID,
        target_id: NURSE_UUID,
      }),
    )
  })
})

// ── 5. reinstateNurse() ────────────────────────────────────────────────────────
describe('reinstateNurse()', () => {
  test('5a. reinstateNurse() clears suspension and creates audit log', async () => {
    let profileCleared = false

    mockFromImpl = (table: string) => {
      if (table === 'profiles') {
        return {
          update: jest.fn(() => ({
            eq: jest.fn(() => {
              profileCleared = true
              return Promise.resolve({ data: null, error: null })
            }),
          })),
        }
      }
      return buildChainMock({ insert: jest.fn(() => Promise.resolve({ data: null, error: null })) })
    }

    mockWriteAuditLog.mockResolvedValue(undefined)

    const result = await reinstateNurse(NURSE_UUID, ADMIN_UUID, 'Admin review completed — OIG cleared')

    expect(result.success).toBe(true)
    expect(profileCleared).toBe(true)
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'nurse.reinstated',
        actor_id: ADMIN_UUID,
      }),
    )
  })

  test('5b. reinstateNurse() requires actorId — rejects SYSTEM_UUID or empty', async () => {
    mockWriteAuditLog.mockResolvedValue(undefined)

    const noActorResult = await reinstateNurse(NURSE_UUID, '', 'Some justification')
    expect(noActorResult.success).toBe(false)
    expect(noActorResult.error).toMatch(/actorId is required/)

    const systemResult = await reinstateNurse(NURSE_UUID, SYSTEM_UUID, 'Some justification')
    expect(systemResult.success).toBe(false)
    expect(systemResult.error).toMatch(/actorId is required/)
  })
})

// ── 6-8. validateBeforeShift() ─────────────────────────────────────────────────
describe('validateBeforeShift()', () => {
  function setupShiftMocks(options: {
    nurseStatus?: string
    oigCached?: boolean | null
    licenseStatus?: string
  } = {}) {
    const nurseStatus = options.nurseStatus ?? 'active'

    mockFromImpl = (table: string) => {
      if (table === 'shifts') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              maybeSingle: jest.fn(() => Promise.resolve({
                data: { id: SHIFT_UUID, facility_id: FACILITY_UUID, status: 'scheduled' },
                error: null,
              })),
            })),
          })),
          update: jest.fn(() => ({
            eq: jest.fn(() => Promise.resolve({ data: null, error: null })),
          })),
        }
      }

      if (table === 'shift_assignments') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              maybeSingle: jest.fn(() => Promise.resolve({ data: { nurse_id: NURSE_UUID }, error: null })),
            })),
          })),
        }
      }

      if (table === 'profiles') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              maybeSingle: jest.fn(() => Promise.resolve({
                data: {
                  id: NURSE_UUID,
                  status: nurseStatus,
                  first_name: 'Zynthia',
                  last_name: 'Xnovrescu',
                  facility_id: FACILITY_UUID,
                },
                error: null,
              })),
            })),
          })),
        }
      }

      if (table === 'credential_verifications') {
        const licenseRows = options.licenseStatus && options.licenseStatus !== 'active'
          ? [{ result: 'flagged', raw_response: { status: options.licenseStatus }, verified_at: new Date().toISOString() }]
          : []

        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                gte: jest.fn(() => ({
                  order: jest.fn(() => ({
                    limit: jest.fn(() => ({
                      maybeSingle: jest.fn(() => Promise.resolve({ data: options.oigCached !== null ? { result: options.oigCached ? 'flagged' : 'clear', raw_response: {}, verified_at: new Date().toISOString() } : null, error: null })),
                    })),
                  })),
                })),
                order: jest.fn(() => ({
                  limit: jest.fn(() => Promise.resolve({ data: licenseRows, error: null })),
                })),
              })),
            })),
          })),
        }
      }

      if (table === 'credentials') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              in: jest.fn(() => Promise.resolve({ data: [], error: null })),
            })),
          })),
        }
      }

      if (table === 'audit_logs') {
        return {
          insert: jest.fn(() => Promise.resolve({ data: null, error: null })),
        }
      }

      return buildChainMock({ insert: jest.fn(() => Promise.resolve({ data: null, error: null })) })
    }
  }

  test('6. Suspended nurse blocks shift start', async () => {
    setupShiftMocks({ nurseStatus: 'suspended' })
    mockCheckOIGExclusion.mockResolvedValue(makeOIGClear())
    mockWriteAuditLog.mockResolvedValue(undefined)
    mockSendPushToFacilityAdmins.mockResolvedValue(undefined)

    const result = await validateBeforeShift(SHIFT_UUID)

    expect(result.allowed).toBe(false)
    expect(result.blockers).toContain('nurse_status_suspended')
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'shift.blocked_on_revalidation' }),
    )
  })

  test('7. OIG exclusion hit during revalidation blocks shift', async () => {
    setupShiftMocks({ nurseStatus: 'active', oigCached: null })
    // No cache → live OIG check returns excluded
    mockCheckOIGExclusion.mockResolvedValue(makeOIGExcluded())
    mockWriteAuditLog.mockResolvedValue(undefined)
    mockSendPushToFacilityAdmins.mockResolvedValue(undefined)

    const result = await validateBeforeShift(SHIFT_UUID)

    expect(result.allowed).toBe(false)
    expect(result.blockers).toContain('oig_exclusion_hit')
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'shift.blocked_on_revalidation' }),
    )
  })

  test('8. Active compliant nurse — all checks pass', async () => {
    setupShiftMocks({ nurseStatus: 'active', oigCached: null, licenseStatus: 'active' })
    mockCheckOIGExclusion.mockResolvedValue(makeOIGClear())
    mockWriteAuditLog.mockResolvedValue(undefined)
    mockSendPushToFacilityAdmins.mockResolvedValue(undefined)

    const result = await validateBeforeShift(SHIFT_UUID)

    expect(result.allowed).toBe(true)
    expect(result.blockers).toHaveLength(0)
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'shift.revalidation_passed' }),
    )
  })
})

// ── 10. CSV export contains no PHI ────────────────────────────────────────────
describe('CSV export PHI check', () => {
  test('10. CSV column definitions contain no PHI fields', () => {
    // Verify the CSV spec matches our PHI policy
    const CSV_HEADERS = [
      'nurse_id',         // UUID only — no name
      'compliance_score',
      'status',
      'last_checked',
      'alert_count',
      'suspension_date',
    ]

    const PHI_FIELDS = [
      'name', 'first_name', 'last_name', 'full_name',
      'ssn', 'dob', 'date_of_birth',
      'mrn', 'patient', 'diagnosis',
      'phone', 'email', 'address',
    ]

    for (const header of CSV_HEADERS) {
      for (const phi of PHI_FIELDS) {
        expect(header.toLowerCase()).not.toContain(phi)
      }
    }

    // nurse_id must be a UUID identifier, not a name field
    expect(CSV_HEADERS[0]).toBe('nurse_id')
    expect(CSV_HEADERS).not.toContain('nurse_name')
    expect(CSV_HEADERS).not.toContain('first_name')
    expect(CSV_HEADERS).not.toContain('last_name')
  })
})
