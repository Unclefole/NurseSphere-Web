/**
 * NURSYS License Verifier — Unit Tests
 *
 * PHI note: tests use synthetic license numbers and names.
 * No real nurse data is used here.
 */

import { verifyNurseLicense, type NURSYSResult } from '@/lib/verification/nursys-checker'

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      insert: jest.fn(() => Promise.resolve({ data: null, error: null })),
    })),
  })),
}))

const mockFetch = jest.fn()
global.fetch = mockFetch

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
})

afterEach(() => {
  jest.clearAllMocks()
  // Reset env so each test can set its own
  delete process.env.NURSYS_API_KEY
})

// ── Test data ──────────────────────────────────────────────────────────────────

const BASE_PARAMS = {
  licenseNumber: 'RN-TEST-99999',
  issuingState: 'CA',
  lastName: 'Xnovrescu',
  nurseId: 'nurse-uuid-101',
}

// ── Tests: stub mode (no API key) ──────────────────────────────────────────────

describe('verifyNurseLicense — no API key', () => {
  test('returns stub result with status="unverified" when NURSYS_API_KEY not set', async () => {
    // Ensure key is absent
    delete process.env.NURSYS_API_KEY

    const result: NURSYSResult = await verifyNurseLicense(BASE_PARAMS)

    expect(result.valid).toBe(false)
    expect(result.status).toBe('unverified')
    expect(result.source).toBe('NURSYS')
    expect(result.note).toContain('NURSYS_API_KEY not configured')
    expect(result.licenseNumber).toBe(BASE_PARAMS.licenseNumber)
    expect(result.issuingState).toBe(BASE_PARAMS.issuingState)
    // Must never throw
  })

  test('never throws even when Supabase insert fails', async () => {
    delete process.env.NURSYS_API_KEY
    const { createClient } = jest.requireMock('@supabase/supabase-js')
    createClient.mockReturnValueOnce({
      from: jest.fn(() => ({
        insert: jest.fn(() => Promise.resolve({ data: null, error: { message: 'table missing' } })),
      })),
    })

    await expect(verifyNurseLicense(BASE_PARAMS)).resolves.toBeDefined()
  })
})

// ── Tests: live API mode ───────────────────────────────────────────────────────

describe('verifyNurseLicense — with API key', () => {
  beforeEach(() => {
    process.env.NURSYS_API_KEY = 'test-nursys-key-abc123'
  })

  test('active license → { valid: true, status: "active" }', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        licenseStatus: 'Active',
        expirationDate: '2026-12-31',
        disciplinaryAction: false,
        compactStatus: true,
        licenseType: 'RN',
      }),
    })

    const result: NURSYSResult = await verifyNurseLicense(BASE_PARAMS)

    expect(result.valid).toBe(true)
    expect(result.status).toBe('active')
    expect(result.expirationDate).toBe('2026-12-31')
    expect(result.disciplinaryActions).toBe(false)
    expect(result.compactPrivilege).toBe(true)
    expect(result.source).toBe('NURSYS')
  })

  test('expired license → { valid: false, status: "expired" }', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        licenseStatus: 'Expired',
        expirationDate: '2022-06-30',
        disciplinaryAction: false,
      }),
    })

    const result: NURSYSResult = await verifyNurseLicense(BASE_PARAMS)

    expect(result.valid).toBe(false)
    expect(result.status).toBe('expired')
  })

  test('revoked license → result "flagged", compliance alert created', async () => {
    const { createClient } = jest.requireMock('@supabase/supabase-js')
    const mockInsert = jest.fn(() => Promise.resolve({ data: null, error: null }))
    createClient.mockReturnValueOnce({
      from: jest.fn(() => ({
        insert: mockInsert,
      })),
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        licenseStatus: 'Revoked',
        expirationDate: '2023-01-01',
        disciplinaryAction: true,
      }),
    })

    const result: NURSYSResult = await verifyNurseLicense({
      ...BASE_PARAMS,
      facilityId: 'facility-xyz',
    })

    expect(result.valid).toBe(false)
    expect(result.status).toBe('revoked')
    expect(result.disciplinaryActions).toBe(true)

    // Wait for fire-and-forget persistence
    await new Promise((r) => setTimeout(r, 50))

    // Verify the credential_verifications insert had result='flagged'
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        verification_type: 'nursys_license',
        result: 'flagged',
        nurse_id: BASE_PARAMS.nurseId,
      }),
    )
  })

  test('surrendered license → result "flagged"', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        licenseStatus: 'Surrendered',
        expirationDate: '2021-06-01',
        disciplinaryAction: true,
      }),
    })

    const result: NURSYSResult = await verifyNurseLicense(BASE_PARAMS)
    expect(result.valid).toBe(false)
    expect(result.status).toBe('surrendered')
  })

  test('license not found (404) → { valid: false, status: "not_found" }', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
    })

    const result: NURSYSResult = await verifyNurseLicense(BASE_PARAMS)

    expect(result.valid).toBe(false)
    expect(result.status).toBe('not_found')
    expect(result.source).toBe('NURSYS')
  })

  test('NURSYS API server error → { status: "error" }, no throw', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
    })

    const result: NURSYSResult = await verifyNurseLicense(BASE_PARAMS)

    expect(result.status).toBe('error')
    expect(result.note).toContain('503')
  })

  test('NURSYS request times out → { status: "error" }, no throw', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError')
    mockFetch.mockRejectedValueOnce(abortError)

    const result: NURSYSResult = await verifyNurseLicense(BASE_PARAMS)

    expect(result.status).toBe('error')
    expect(result.note).toContain('timed out')
  })

  test('network failure → { status: "error" }, no throw', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const result: NURSYSResult = await verifyNurseLicense(BASE_PARAMS)
    expect(result.status).toBe('error')
    expect(result.valid).toBe(false)
  })

  test('result stored in credential_verifications table on success', async () => {
    const { createClient } = jest.requireMock('@supabase/supabase-js')
    const mockInsert = jest.fn(() => Promise.resolve({ data: null, error: null }))
    createClient.mockReturnValueOnce({
      from: jest.fn(() => ({
        insert: mockInsert,
      })),
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        licenseStatus: 'Active',
        expirationDate: '2027-01-01',
        disciplinaryAction: false,
      }),
    })

    await verifyNurseLicense({ ...BASE_PARAMS, credentialId: 'cred-uuid-001' })
    await new Promise((r) => setTimeout(r, 50))

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        nurse_id: BASE_PARAMS.nurseId,
        credential_id: 'cred-uuid-001',
        verification_type: 'nursys_license',
        result: 'clear',
      }),
    )
  })

  test('raw_response does NOT contain lastName (PHI protection)', async () => {
    const { createClient } = jest.requireMock('@supabase/supabase-js')
    const mockInsert = jest.fn(() => Promise.resolve({ data: null, error: null }))
    createClient.mockReturnValueOnce({
      from: jest.fn(() => ({
        insert: mockInsert,
      })),
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        licenseStatus: 'Active',
        expirationDate: '2027-01-01',
        disciplinaryAction: false,
      }),
    })

    await verifyNurseLicense(BASE_PARAMS)
    await new Promise((r) => setTimeout(r, 50))

    const insertCall = (mockInsert.mock.calls as unknown[][])[0]?.[0] as Record<string, unknown> | undefined
    const rawResponse = insertCall?.raw_response as Record<string, unknown>

    // lastName must not be present in stored raw_response
    expect(rawResponse).not.toHaveProperty('lastName')
    expect(rawResponse).not.toHaveProperty('last_name')
    // licenseNumber and state are okay (not PHI)
    expect(rawResponse.licenseNumber).toBe(BASE_PARAMS.licenseNumber)
    expect(rawResponse.issuingState).toBe(BASE_PARAMS.issuingState)
  })
})
