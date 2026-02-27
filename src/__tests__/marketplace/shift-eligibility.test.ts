/**
 * Marketplace Shift Eligibility Tests
 *
 * Tests the business logic for:
 *   - Open shift visibility in the marketplace
 *   - Filled shift exclusion
 *   - Compliance score gate (< 60 cannot apply)
 *   - Duplicate application prevention
 *   - Admin accept flow: shift → assigned, other apps → rejected
 *
 * Strategy: pure function / logic tests where possible, with typed mocks.
 * No DB, no network.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

type ShiftStatus = 'open' | 'filled' | 'in_progress' | 'completed' | 'cancelled'
type AppStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'expired'

interface Shift {
  id: string
  facility_id: string
  status: ShiftStatus
  hourly_rate: number
  start_time: string
  end_time: string
  specialty_required: string | null
}

interface Application {
  id: string
  shift_id: string
  nurse_id: string
  facility_id: string
  status: AppStatus
}

interface ComplianceScore {
  nurse_id: string
  score: number
}

// ─── Business Logic (mirrors API route logic) ─────────────────────────────────

/**
 * Determines if a shift should appear in the marketplace.
 */
function isShiftMarketplaceEligible(shift: Shift): boolean {
  return shift.status === 'open'
}

/**
 * Determines if a nurse can apply to a shift.
 * Returns { allowed: boolean; reason?: string }
 */
function canNurseApply(
  shift: Shift,
  nurseId: string,
  existingApplications: Application[],
  complianceScore: ComplianceScore | null
): { allowed: boolean; reason?: string } {
  // 1. Shift must be open
  if (shift.status !== 'open') {
    return { allowed: false, reason: 'Shift is not open' }
  }

  // 2. Compliance score >= 60
  const score = complianceScore?.score ?? 0
  if (score < 60) {
    return {
      allowed: false,
      reason: `Compliance score ${Math.round(score)} is below minimum of 60`,
    }
  }

  // 3. No existing non-withdrawn application
  const existing = existingApplications.find(
    a => a.shift_id === shift.id && a.nurse_id === nurseId
  )
  if (existing && existing.status !== 'withdrawn') {
    return { allowed: false, reason: 'Already applied to this shift' }
  }

  return { allowed: true }
}

/**
 * Simulates admin accepting an application.
 * Returns updated applications and shift status.
 */
function processAcceptDecision(
  applications: Application[],
  acceptApplicationId: string,
  adminId: string,
  now: string
): {
  updatedApplications: Application[]
  updatedShiftStatus: ShiftStatus
} {
  const updatedApplications: Application[] = applications.map(app => {
    if (app.id === acceptApplicationId) {
      return { ...app, status: 'accepted' }
    }
    if (app.status === 'pending') {
      return { ...app, status: 'rejected' }
    }
    return app
  })

  return {
    updatedApplications,
    updatedShiftStatus: 'filled',
  }
}

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    facility_id: 'fac-1',
    status: 'open',
    hourly_rate: 45,
    start_time: new Date(Date.now() + 48 * 3_600_000).toISOString(),
    end_time: new Date(Date.now() + 60 * 3_600_000).toISOString(),
    specialty_required: 'RN',
    ...overrides,
  }
}

function makeApp(overrides: Partial<Application> = {}): Application {
  return {
    id: 'app-1',
    shift_id: 'shift-1',
    nurse_id: 'nurse-1',
    facility_id: 'fac-1',
    status: 'pending',
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Marketplace: shift visibility', () => {
  test('open shift → appears in marketplace', () => {
    const shift = makeShift({ status: 'open' })
    expect(isShiftMarketplaceEligible(shift)).toBe(true)
  })

  test('filled shift → excluded from marketplace', () => {
    const shift = makeShift({ status: 'filled' })
    expect(isShiftMarketplaceEligible(shift)).toBe(false)
  })

  test('cancelled shift → excluded from marketplace', () => {
    const shift = makeShift({ status: 'cancelled' })
    expect(isShiftMarketplaceEligible(shift)).toBe(false)
  })

  test('in_progress shift → excluded from marketplace', () => {
    const shift = makeShift({ status: 'in_progress' })
    expect(isShiftMarketplaceEligible(shift)).toBe(false)
  })

  test('completed shift → excluded from marketplace', () => {
    const shift = makeShift({ status: 'completed' })
    expect(isShiftMarketplaceEligible(shift)).toBe(false)
  })
})

describe('Marketplace: nurse apply eligibility', () => {
  test('eligible nurse, open shift, no prior application → can apply', () => {
    const shift = makeShift({ status: 'open' })
    const result = canNurseApply(shift, 'nurse-1', [], { nurse_id: 'nurse-1', score: 85 })
    expect(result.allowed).toBe(true)
  })

  test('nurse with compliance score < 60 → cannot apply', () => {
    const shift = makeShift({ status: 'open' })
    const result = canNurseApply(shift, 'nurse-1', [], { nurse_id: 'nurse-1', score: 55 })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/55/)
  })

  test('nurse with compliance score exactly 60 → can apply', () => {
    const shift = makeShift({ status: 'open' })
    const result = canNurseApply(shift, 'nurse-1', [], { nurse_id: 'nurse-1', score: 60 })
    expect(result.allowed).toBe(true)
  })

  test('nurse with no compliance record (score = 0) → cannot apply', () => {
    const shift = makeShift({ status: 'open' })
    const result = canNurseApply(shift, 'nurse-1', [], null)
    expect(result.allowed).toBe(false)
  })

  test('nurse already applied (pending) → cannot apply again', () => {
    const shift = makeShift({ status: 'open' })
    const existing = [makeApp({ nurse_id: 'nurse-1', status: 'pending' })]
    const result = canNurseApply(shift, 'nurse-1', existing, { nurse_id: 'nurse-1', score: 80 })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/already applied/i)
  })

  test('nurse with accepted application → cannot apply again', () => {
    const shift = makeShift({ status: 'open' })
    const existing = [makeApp({ nurse_id: 'nurse-1', status: 'accepted' })]
    const result = canNurseApply(shift, 'nurse-1', existing, { nurse_id: 'nurse-1', score: 80 })
    expect(result.allowed).toBe(false)
  })

  test('nurse with withdrawn application → can apply again', () => {
    const shift = makeShift({ status: 'open' })
    const existing = [makeApp({ nurse_id: 'nurse-1', status: 'withdrawn' })]
    const result = canNurseApply(shift, 'nurse-1', existing, { nurse_id: 'nurse-1', score: 80 })
    expect(result.allowed).toBe(true)
  })

  test('filled shift → nurse cannot apply', () => {
    const shift = makeShift({ status: 'filled' })
    const result = canNurseApply(shift, 'nurse-1', [], { nurse_id: 'nurse-1', score: 90 })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/not open/)
  })
})

describe('Marketplace: admin accept decision', () => {
  const shiftId = 'shift-1'
  const facilityId = 'fac-1'
  const now = new Date().toISOString()

  const applications: Application[] = [
    makeApp({ id: 'app-1', shift_id: shiftId, nurse_id: 'nurse-1', facility_id: facilityId, status: 'pending' }),
    makeApp({ id: 'app-2', shift_id: shiftId, nurse_id: 'nurse-2', facility_id: facilityId, status: 'pending' }),
    makeApp({ id: 'app-3', shift_id: shiftId, nurse_id: 'nurse-3', facility_id: facilityId, status: 'pending' }),
  ]

  test('admin accepts app-1 → app-1 becomes accepted', () => {
    const { updatedApplications } = processAcceptDecision(applications, 'app-1', 'admin-1', now)
    const accepted = updatedApplications.find(a => a.id === 'app-1')
    expect(accepted?.status).toBe('accepted')
  })

  test('admin accepts app-1 → shift status becomes filled', () => {
    const { updatedShiftStatus } = processAcceptDecision(applications, 'app-1', 'admin-1', now)
    expect(updatedShiftStatus).toBe('filled')
  })

  test('admin accepts app-1 → all other pending applications become rejected', () => {
    const { updatedApplications } = processAcceptDecision(applications, 'app-1', 'admin-1', now)
    const others = updatedApplications.filter(a => a.id !== 'app-1')
    expect(others.every(a => a.status === 'rejected')).toBe(true)
  })

  test('admin accepts app-1 → exactly 1 accepted, rest rejected', () => {
    const { updatedApplications } = processAcceptDecision(applications, 'app-1', 'admin-1', now)
    const acceptedCount = updatedApplications.filter(a => a.status === 'accepted').length
    const rejectedCount = updatedApplications.filter(a => a.status === 'rejected').length
    expect(acceptedCount).toBe(1)
    expect(rejectedCount).toBe(2)
  })

  test('already-withdrawn applications are not affected by accept decision', () => {
    const mixedApps: Application[] = [
      makeApp({ id: 'app-1', nurse_id: 'nurse-1', status: 'pending' }),
      makeApp({ id: 'app-2', nurse_id: 'nurse-2', status: 'withdrawn' }),
    ]
    const { updatedApplications } = processAcceptDecision(mixedApps, 'app-1', 'admin-1', now)
    const withdrawn = updatedApplications.find(a => a.id === 'app-2')
    // Withdrawn apps are not pending, so they are not changed
    expect(withdrawn?.status).toBe('withdrawn')
  })
})
