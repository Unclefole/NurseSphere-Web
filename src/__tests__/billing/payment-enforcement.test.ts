/**
 * Payment Enforcement Tests
 *
 * Covers:
 *   - hasValidPaymentMethod edge cases not in payment-guard.test.ts
 *   - POST /api/shifts enforcement (402 on missing PM, 201 on valid PM)
 *
 * Mocks Supabase, Stripe, and Next.js route deps so no real I/O.
 */

// ─── Module mocks (must precede imports) ─────────────────────────────────────

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseAdminClient: jest.fn(),
  createSupabaseServerClient: jest.fn(),
  getAuthenticatedHospital: jest.fn(),
}))

jest.mock('@/lib/stripe/client', () => ({
  getStripe: jest.fn(),
}))

jest.mock('@/lib/audit', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
  extractRequestMeta: jest.fn().mockReturnValue({ ip_address: '127.0.0.1' }),
}))

jest.mock('@/lib/validation/schemas', () => ({
  parseAndValidate: jest.fn(),
  createShiftSchema: {},
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

import { createSupabaseAdminClient, createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { getStripe } from '@/lib/stripe/client'
import { parseAndValidate } from '@/lib/validation/schemas'
import { hasValidPaymentMethod } from '@/lib/billing/payment-guard'

const mockCreateSupabaseAdminClient = createSupabaseAdminClient as jest.Mock
const mockCreateSupabaseServerClient = createSupabaseServerClient as jest.Mock
const mockGetAuthenticatedHospital = getAuthenticatedHospital as jest.Mock
const mockGetStripe = getStripe as jest.Mock
const mockParseAndValidate = parseAndValidate as jest.Mock

// ─── Supabase mock builder ────────────────────────────────────────────────────

function buildSupabaseMock(facilityData: Record<string, unknown> | null, error: unknown = null) {
  const singleFn = jest.fn().mockResolvedValue({ data: facilityData, error })
  const eqFn = jest.fn().mockReturnValue({ single: singleFn })
  const selectFn = jest.fn().mockReturnValue({ eq: eqFn })
  const updateEqFn = jest.fn().mockResolvedValue({ data: null, error: null })
  const updateFn = jest.fn().mockReturnValue({ eq: updateEqFn })
  const fromFn = jest.fn().mockReturnValue({ select: selectFn, update: updateFn })
  return { from: fromFn }
}

function buildStripeMock(cards: unknown[] = []) {
  return {
    paymentMethods: {
      retrieve: jest.fn().mockResolvedValue({ id: cards[0] ?? 'pm_123' }),
      list: jest.fn().mockResolvedValue({ data: cards }),
    },
  }
}

// ─── hasValidPaymentMethod ────────────────────────────────────────────────────

describe('hasValidPaymentMethod', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('facility with Stripe customer + PM → true', async () => {
    const facilityData = {
      stripe_customer_id: 'cus_test',
      payment_method_status: 'active',
      default_payment_method_id: 'pm_live',
    }
    mockCreateSupabaseAdminClient.mockReturnValue(buildSupabaseMock(facilityData))
    const stripe = buildStripeMock([{ id: 'pm_live' }])
    stripe.paymentMethods.retrieve = jest.fn().mockResolvedValue({ id: 'pm_live' })
    mockGetStripe.mockReturnValue(stripe)

    const result = await hasValidPaymentMethod('fac-001')

    expect(result).toBe(true)
  })

  test('facility with no Stripe customer → false', async () => {
    const facilityData = {
      stripe_customer_id: null,
      payment_method_status: null,
      default_payment_method_id: null,
    }
    mockCreateSupabaseAdminClient.mockReturnValue(buildSupabaseMock(facilityData))
    // Stripe list should never be called since there's no customer
    const stripe = buildStripeMock([])
    mockGetStripe.mockReturnValue(stripe)

    const result = await hasValidPaymentMethod('fac-no-customer')

    expect(result).toBe(false)
    expect(stripe.paymentMethods.list).not.toHaveBeenCalled()
  })

  test('facility with customer but no PM → false', async () => {
    const facilityData = {
      stripe_customer_id: 'cus_empty',
      payment_method_status: null,
      default_payment_method_id: null,
    }
    mockCreateSupabaseAdminClient.mockReturnValue(buildSupabaseMock(facilityData))
    // Stripe returns empty list
    const stripe = buildStripeMock([])
    mockGetStripe.mockReturnValue(stripe)

    const result = await hasValidPaymentMethod('fac-empty-pm')

    expect(result).toBe(false)
  })

  test('DB error → returns false (fail closed)', async () => {
    // Simulate a thrown error from Supabase
    const brokenFrom = jest.fn().mockImplementation(() => {
      throw new Error('Database connection failed')
    })
    mockCreateSupabaseAdminClient.mockReturnValue({ from: brokenFrom })
    mockGetStripe.mockReturnValue(buildStripeMock())

    const result = await hasValidPaymentMethod('fac-db-error')

    // Must fail closed — never allow shift creation if we can't verify
    expect(result).toBe(false)
  })
})

// ─── POST /api/shifts enforcement ─────────────────────────────────────────────

describe('POST /api/shifts — payment enforcement', () => {
  const AUTH_STUB = { userId: 'user-1', hospitalId: 'fac-1', email: 'admin@test.com' }

  // Build a minimal Supabase mock for the shifts route (select + insert)
  function buildShiftRouteSupabaseMock(insertResult: { data: unknown; error: unknown }) {
    const singleInsert = jest.fn().mockResolvedValue(insertResult)
    const selectAfterInsert = jest.fn().mockReturnValue({ single: singleInsert })
    const insertFn = jest.fn().mockReturnValue({ select: selectAfterInsert })

    // For GET-style query (order/range used in GET, not POST)
    const singleSelect = jest.fn().mockResolvedValue({ data: null, error: null })
    const eqFn = jest.fn().mockReturnValue({ single: singleSelect })
    const selectFn = jest.fn().mockReturnValue({ eq: eqFn, insert: insertFn })
    const fromFn = jest.fn().mockReturnValue({ select: selectFn, insert: insertFn })
    return { from: fromFn }
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('no payment method → 402 with PAYMENT_METHOD_REQUIRED', async () => {
    // hasValidPaymentMethod will call createSupabaseAdminClient (via the guard)
    // We simulate missing PM by returning null facility data
    const noFacilityMock = buildSupabaseMock(null, { code: 'PGRST116', message: 'not found' })
    mockCreateSupabaseAdminClient.mockReturnValue(noFacilityMock)
    mockGetStripe.mockReturnValue(buildStripeMock([]))

    const serverClientMock = buildShiftRouteSupabaseMock({ data: null, error: null })
    mockCreateSupabaseServerClient.mockResolvedValue(serverClientMock)
    mockGetAuthenticatedHospital.mockResolvedValue(AUTH_STUB)

    // Dynamically import route to ensure mocks are in place
    const { POST } = await import('@/app/api/shifts/route')

    const request = new Request('http://localhost:3000/api/shifts', {
      method: 'POST',
      body: JSON.stringify({
        title: 'ICU Nurse',
        startTime: '2026-03-01T08:00:00Z',
        endTime: '2026-03-01T20:00:00Z',
        hourlyRate: 55,
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await POST(request as unknown as import('next/server').NextRequest)
    const body = await response.json()

    expect(response.status).toBe(402)
    expect(body.error).toBe('PAYMENT_METHOD_REQUIRED')
  })

  test('payment method exists → 201', async () => {
    // hasValidPaymentMethod returns true — facility has an active PM
    const activeFacility = {
      stripe_customer_id: 'cus_active',
      payment_method_status: 'active',
      default_payment_method_id: 'pm_active',
    }
    const facilityMock = buildSupabaseMock(activeFacility)
    mockCreateSupabaseAdminClient.mockReturnValue(facilityMock)
    const stripe = buildStripeMock()
    stripe.paymentMethods.retrieve = jest.fn().mockResolvedValue({ id: 'pm_active' })
    mockGetStripe.mockReturnValue(stripe)

    const serverClientMock = buildShiftRouteSupabaseMock({
      data: {
        id: 'shift-created',
        facility_id: AUTH_STUB.hospitalId,
        title: 'ICU Nurse',
        status: 'open',
      },
      error: null,
    })
    mockCreateSupabaseServerClient.mockResolvedValue(serverClientMock)
    mockGetAuthenticatedHospital.mockResolvedValue(AUTH_STUB)

    // parseAndValidate returns body + no error
    mockParseAndValidate.mockResolvedValue([
      { title: 'ICU Nurse', startTime: '2026-03-01T08:00:00Z', endTime: '2026-03-01T20:00:00Z', hourlyRate: 55 },
      null,
    ])

    const { POST } = await import('@/app/api/shifts/route')

    const request = new Request('http://localhost:3000/api/shifts', {
      method: 'POST',
      body: JSON.stringify({
        title: 'ICU Nurse',
        startTime: '2026-03-01T08:00:00Z',
        endTime: '2026-03-01T20:00:00Z',
        hourlyRate: 55,
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await POST(request as unknown as import('next/server').NextRequest)
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.shift).toBeDefined()
    expect(body.shift.id).toBe('shift-created')
  })
})
