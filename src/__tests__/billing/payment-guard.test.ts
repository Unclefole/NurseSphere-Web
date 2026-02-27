/**
 * Tests for billing payment guard.
 * Mocks Supabase and Stripe to verify hasValidPaymentMethod logic.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock @/lib/supabase-server so no real DB is needed
jest.mock('@/lib/supabase-server', () => ({
  createSupabaseAdminClient: jest.fn(),
}))

// Mock @/lib/stripe/client so no real Stripe calls are made
jest.mock('@/lib/stripe/client', () => ({
  getStripe: jest.fn(),
}))

import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { getStripe } from '@/lib/stripe/client'
import { hasValidPaymentMethod } from '@/lib/billing/payment-guard'

const mockCreateSupabaseAdminClient = createSupabaseAdminClient as jest.Mock
const mockGetStripe = getStripe as jest.Mock

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildSupabaseMock(facilityData: Record<string, unknown> | null, error: unknown = null) {
  const singleFn = jest.fn().mockResolvedValue({ data: facilityData, error })
  const eqFn = jest.fn().mockReturnValue({ single: singleFn })
  const selectFn = jest.fn().mockReturnValue({ eq: eqFn })
  const fromFn = jest.fn().mockReturnValue({ select: selectFn })
  // Also support update().eq() for the sync path
  const updateEqFn = jest.fn().mockResolvedValue({ data: null, error: null })
  const updateFn = jest.fn().mockReturnValue({ eq: updateEqFn })
  return { from: fromFn, update: updateFn }
}

function buildStripeMock(paymentMethods: unknown[] = []) {
  return {
    paymentMethods: {
      retrieve: jest.fn().mockResolvedValue({ id: 'pm_123' }),
      list: jest.fn().mockResolvedValue({ data: paymentMethods }),
    },
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('hasValidPaymentMethod', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('facility with active payment method → returns true', async () => {
    // Facility has stripe_customer_id + active status + default_payment_method_id
    const facilityData = {
      stripe_customer_id: 'cus_abc123',
      payment_method_status: 'active',
      default_payment_method_id: 'pm_123',
    }

    const supabaseMock = buildSupabaseMock(facilityData)
    mockCreateSupabaseAdminClient.mockReturnValue(supabaseMock)

    const stripeMock = buildStripeMock()
    // retrieve returns the PM with matching id
    stripeMock.paymentMethods.retrieve.mockResolvedValue({ id: 'pm_123' })
    mockGetStripe.mockReturnValue(stripeMock)

    const result = await hasValidPaymentMethod('facility-abc')

    expect(result).toBe(true)
  })

  test('facility without payment method → returns false', async () => {
    // No stripe_customer_id and no default_payment_method_id
    const facilityData = {
      stripe_customer_id: null,
      payment_method_status: null,
      default_payment_method_id: null,
    }

    const supabaseMock = buildSupabaseMock(facilityData)
    mockCreateSupabaseAdminClient.mockReturnValue(supabaseMock)

    // Stripe should not be called since no customer_id
    const stripeMock = buildStripeMock([])
    mockGetStripe.mockReturnValue(stripeMock)

    const result = await hasValidPaymentMethod('facility-no-pm')

    expect(result).toBe(false)
  })

  test('non-existent facility → returns false', async () => {
    // Supabase returns null (row not found)
    const supabaseMock = buildSupabaseMock(null, { code: 'PGRST116', message: 'Row not found' })
    mockCreateSupabaseAdminClient.mockReturnValue(supabaseMock)

    const stripeMock = buildStripeMock()
    mockGetStripe.mockReturnValue(stripeMock)

    const result = await hasValidPaymentMethod('facility-does-not-exist')

    expect(result).toBe(false)
  })

  test('stripe_customer_id exists but no payment methods → returns false', async () => {
    const facilityData = {
      stripe_customer_id: 'cus_existing',
      payment_method_status: null,
      default_payment_method_id: null,
    }

    const supabaseMock = buildSupabaseMock(facilityData)
    mockCreateSupabaseAdminClient.mockReturnValue(supabaseMock)

    // Stripe returns no payment methods
    const stripeMock = buildStripeMock([])
    mockGetStripe.mockReturnValue(stripeMock)

    const result = await hasValidPaymentMethod('facility-no-pm-stripe')

    expect(result).toBe(false)
  })
})
