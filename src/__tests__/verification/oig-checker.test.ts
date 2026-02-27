/**
 * OIG LEIE Exclusion Checker — Unit Tests
 *
 * PHI note: tests use clearly synthetic names that will never appear in OIG data.
 * No real patient or nurse data is used here.
 */

import { checkOIGExclusion, isExcluded, type OIGResult } from '@/lib/verification/oig-checker'

// ── Mocks ──────────────────────────────────────────────────────────────────────

// Mock Supabase to avoid needing a real connection in tests
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      insert: jest.fn(() => Promise.resolve({ data: null, error: null })),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    })),
  })),
}))

// Capture fetch mock for per-test control
const mockFetch = jest.fn()
global.fetch = mockFetch

// Env vars for Supabase (needed to not short-circuit createAdminClient)
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
})

afterEach(() => {
  jest.clearAllMocks()
})

// ── Test data ──────────────────────────────────────────────────────────────────

const CLEAR_NURSE = {
  firstName: 'Zynthia',
  lastName: 'Xnovrescu',
  nurseId: 'nurse-uuid-001',
}

const EXCLUDED_NURSE = {
  firstName: 'Vladko',
  lastName: 'Zerquist',
  nurseId: 'nurse-uuid-002',
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('checkOIGExclusion', () => {
  test('clear nurse → { excluded: false, status: "clear" }', async () => {
    // OIG returns empty exclusions list
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ exclusions: [], total: 0 }),
    })

    const result: OIGResult = await checkOIGExclusion(CLEAR_NURSE)

    expect(result.excluded).toBe(false)
    expect(result.status).toBe('clear')
    expect(result.source).toBe('OIG_LEIE')
    expect(result.checked_at).toBeDefined()
    // Must not throw
  })

  test('excluded nurse → { excluded: true, status: "excluded", reason provided }', async () => {
    // OIG returns a matching exclusion record
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        exclusions: [
          {
            LASTNAME: 'ZERQUIST',
            FIRSTNAME: 'VLADKO',
            EXCLTYPE: 'Section 1128(a)(1)',
            EXCLDATE: '2020-03-15',
            NPI: null,
          },
        ],
        total: 1,
      }),
    })

    const result: OIGResult = await checkOIGExclusion(EXCLUDED_NURSE)

    expect(result.excluded).toBe(true)
    expect(result.status).toBe('excluded')
    expect(result.reason).toBe('Section 1128(a)(1)')
    expect(result.exclusion_date).toBe('2020-03-15')
    expect(result.source).toBe('OIG_LEIE')
  })

  test('OIG API returns HTTP 500 → graceful unavailable result, no throw', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    })

    const result: OIGResult = await checkOIGExclusion(CLEAR_NURSE)

    // Must not throw and must not mark as excluded
    expect(result.excluded).toBe(false)
    expect(result.status).toBe('unavailable')
    expect(result.source).toBe('OIG_LEIE')
    expect(result.note).toContain('500')
  })

  test('OIG API times out → graceful unavailable result, no throw', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError')
    mockFetch.mockRejectedValueOnce(abortError)

    const result: OIGResult = await checkOIGExclusion(CLEAR_NURSE)

    expect(result.excluded).toBe(false)
    expect(result.status).toBe('unavailable')
    expect(result.note).toContain('timed out')
  })

  test('OIG API network failure → graceful unavailable result, no throw', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fetch failed'))

    const result: OIGResult = await checkOIGExclusion(CLEAR_NURSE)

    expect(result.excluded).toBe(false)
    expect(result.status).toBe('unavailable')
    expect(result.source).toBe('OIG_LEIE')
  })

  test('result stored in credential_verifications table (supabase insert called)', async () => {
    const { createClient } = jest.requireMock('@supabase/supabase-js')
    const mockInsert = jest.fn(() => Promise.resolve({ data: null, error: null }))
    createClient.mockReturnValueOnce({
      from: jest.fn(() => ({
        insert: mockInsert,
      })),
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ exclusions: [], total: 0 }),
    })

    await checkOIGExclusion({ ...CLEAR_NURSE, facilityId: 'facility-001' })

    // Give fire-and-forget async a chance to run
    await new Promise((r) => setTimeout(r, 50))

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        nurse_id: CLEAR_NURSE.nurseId,
        verification_type: 'oig_exclusion',
        result: 'clear',
      }),
    )
  })

  test('excluded result maps to "flagged" in credential_verifications', async () => {
    const { createClient } = jest.requireMock('@supabase/supabase-js')
    const mockInsert = jest.fn(() => Promise.resolve({ data: null, error: null }))
    createClient.mockReturnValueOnce({
      from: jest.fn(() => ({
        insert: mockInsert,
      })),
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        exclusions: [
          {
            LASTNAME: 'ZERQUIST',
            FIRSTNAME: 'VLADKO',
            EXCLTYPE: 'Section 1128(a)(1)',
            EXCLDATE: '2020-03-15',
          },
        ],
        total: 1,
      }),
    })

    await checkOIGExclusion(EXCLUDED_NURSE)
    await new Promise((r) => setTimeout(r, 50))

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        nurse_id: EXCLUDED_NURSE.nurseId,
        verification_type: 'oig_exclusion',
        result: 'flagged',
      }),
    )
  })

  test('unavailable result maps to "unverified" in credential_verifications', async () => {
    const { createClient } = jest.requireMock('@supabase/supabase-js')
    const mockInsert = jest.fn(() => Promise.resolve({ data: null, error: null }))
    createClient.mockReturnValueOnce({
      from: jest.fn(() => ({
        insert: mockInsert,
      })),
    })

    mockFetch.mockRejectedValueOnce(new Error('connection refused'))

    await checkOIGExclusion(CLEAR_NURSE)
    await new Promise((r) => setTimeout(r, 50))

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        verification_type: 'oig_exclusion',
        result: 'unverified',
      }),
    )
  })

  test('NPI mismatch prevents false positive match for common names', async () => {
    // Record has same name but different NPI
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        exclusions: [
          {
            LASTNAME: 'XNOVRESCU',
            FIRSTNAME: 'ZYNTHIA',
            NPI: '9999999999', // different NPI
            EXCLTYPE: 'Section 1128(a)(1)',
            EXCLDATE: '2021-01-01',
          },
        ],
      }),
    })

    const result = await checkOIGExclusion({
      ...CLEAR_NURSE,
      npi: '1234567890', // does not match record
    })

    expect(result.excluded).toBe(false)
    expect(result.status).toBe('clear')
  })
})

describe('isExcluded', () => {
  test('returns true when OIG check finds exclusion', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        exclusions: [
          {
            LASTNAME: 'ZERQUIST',
            FIRSTNAME: 'VLADKO',
            EXCLTYPE: 'Section 1128(a)(1)',
            EXCLDATE: '2020-03-15',
          },
        ],
      }),
    })

    const excluded = await isExcluded('Vladko', 'Zerquist', 'nurse-uuid-003')
    expect(excluded).toBe(true)
  })

  test('returns false when OIG check is clear', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ exclusions: [] }),
    })

    const excluded = await isExcluded('Zynthia', 'Xnovrescu', 'nurse-uuid-004')
    expect(excluded).toBe(false)
  })

  test('returns false when OIG is unavailable (fail safe)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('DNS failure'))
    const excluded = await isExcluded('Test', 'Nurse', 'nurse-uuid-005')
    expect(excluded).toBe(false)
  })
})
