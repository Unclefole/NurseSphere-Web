/**
 * Timecard Approval → Payout Tests
 *
 * Covers the POST /api/timecards/[id]/approve route:
 *   - Updates status to 'approved'
 *   - Sets approved_by and approved_at
 *   - Triggers invoice (via triggerInvoiceOnShiftCompletion)
 *   - Already approved → 422 conflict
 *   - Disputed timecard → cannot approve (no clock_out)
 *   - Wrong facility admin → 403
 */

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
  getAuthenticatedHospital: jest.fn(),
}))

jest.mock('@/lib/audit', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
  extractRequestMeta: jest.fn().mockReturnValue({ ip_address: '127.0.0.1' }),
}))

jest.mock('@/lib/notifications/notification-service', () => ({
  notifyInvoiceCreated: jest.fn().mockResolvedValue(undefined),
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import type { NextRequest } from 'next/server'

const mockCreateSupabaseServerClient = createSupabaseServerClient as jest.Mock
const mockGetAuthenticatedHospital = getAuthenticatedHospital as jest.Mock

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ADMIN = { userId: 'admin-1', hospitalId: 'fac-1', email: 'admin@test.com' }
const TIMECARD_ID = 'tc-abc-123'

function buildTimecardFromMock(overrides: Record<string, unknown> = {}) {
  return {
    id: TIMECARD_ID,
    shift_id: 'shift-1',
    nurse_id: 'nurse-1',
    facility_id: 'fac-1',
    status: 'pending',
    total_hours: 8,
    clock_in_at: '2026-03-01T08:00:00Z',
    clock_out_at: '2026-03-01T16:00:00Z',
    break_minutes: 30,
    ...overrides,
  }
}

/** Builds a Supabase mock suitable for the approve route. */
function buildSupabaseMock({
  timecardData,
  timecardError = null,
  shiftData = { hourly_rate: 50 },
  updateResult = { data: { id: TIMECARD_ID, status: 'approved', approved_by: ADMIN.userId, approved_at: expect.any(String) }, error: null },
  invoiceInsertResult = { data: { id: 'inv-1' }, error: null },
}: {
  timecardData?: Record<string, unknown> | null
  timecardError?: unknown
  shiftData?: Record<string, unknown> | null
  updateResult?: { data: unknown; error: unknown }
  invoiceInsertResult?: { data: unknown; error: unknown }
}) {
  // Timecard fetch chain: .from('timecards').select(...).eq('id').single()
  const timecardSingle = jest.fn().mockResolvedValue({ data: timecardData ?? buildTimecardFromMock(), error: timecardError })
  const timecardEq = jest.fn().mockReturnValue({ single: timecardSingle })
  const timecardSelect = jest.fn().mockReturnValue({ eq: timecardEq })

  // Shift fetch chain: .from('shifts').select('hourly_rate').eq('id').single()
  const shiftSingle = jest.fn().mockResolvedValue({ data: shiftData, error: null })
  const shiftEq = jest.fn().mockReturnValue({ single: shiftSingle })
  const shiftSelect = jest.fn().mockReturnValue({ eq: shiftEq })

  // Timecard update chain: .from('timecards').update({...}).eq('id').select().single()
  const updateSingle = jest.fn().mockResolvedValue(updateResult)
  const updateSelectFn = jest.fn().mockReturnValue({ single: updateSingle })
  const updateEq = jest.fn().mockReturnValue({ select: updateSelectFn })
  const updateFn = jest.fn().mockReturnValue({ eq: updateEq })

  // Invoice insert chain: .from('invoices').insert({...}).select().single()
  const invoiceSingle = jest.fn().mockResolvedValue(invoiceInsertResult)
  const invoiceSelectFn = jest.fn().mockReturnValue({ single: invoiceSingle })
  const invoiceInsertFn = jest.fn().mockReturnValue({ select: invoiceSelectFn })

  const fromFn = jest.fn().mockImplementation((table: string) => {
    if (table === 'timecards') return { select: timecardSelect, update: updateFn }
    if (table === 'shifts') return { select: shiftSelect }
    if (table === 'invoices') return { insert: invoiceInsertFn }
    return { select: jest.fn(), insert: jest.fn() }
  })

  return { from: fromFn }
}

function makeApproveRequest(timecardId: string = TIMECARD_ID): NextRequest {
  return new Request(`http://localhost:3000/api/timecards/${timecardId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }) as unknown as NextRequest
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/timecards/[id]/approve', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Silence nurse-payout fetch errors in test output
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('approve timecard — updates status to approved', async () => {
    const updatedTimecard = {
      id: TIMECARD_ID,
      status: 'approved',
      approved_by: ADMIN.userId,
      approved_at: new Date().toISOString(),
    }
    const supabase = buildSupabaseMock({
      updateResult: { data: updatedTimecard, error: null },
    })
    mockCreateSupabaseServerClient.mockResolvedValue(supabase)
    mockGetAuthenticatedHospital.mockResolvedValue(ADMIN)

    const { POST } = await import('@/app/api/timecards/[id]/approve/route')
    const res = await POST(makeApproveRequest(), { params: Promise.resolve({ id: TIMECARD_ID }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.timecard.status).toBe('approved')
  })

  test('approve timecard — sets approved_by and approved_at', async () => {
    const now = new Date().toISOString()
    const updatedTimecard = {
      id: TIMECARD_ID,
      status: 'approved',
      approved_by: ADMIN.userId,
      approved_at: now,
    }
    const supabase = buildSupabaseMock({
      updateResult: { data: updatedTimecard, error: null },
    })
    mockCreateSupabaseServerClient.mockResolvedValue(supabase)
    mockGetAuthenticatedHospital.mockResolvedValue(ADMIN)

    const { POST } = await import('@/app/api/timecards/[id]/approve/route')
    const res = await POST(makeApproveRequest(), { params: Promise.resolve({ id: TIMECARD_ID }) })
    const body = await res.json()

    expect(body.timecard.approved_by).toBe(ADMIN.userId)
    expect(body.timecard.approved_at).toBe(now)
  })

  test('approve timecard — triggers invoice (triggerInvoiceOnShiftCompletion)', async () => {
    const supabase = buildSupabaseMock({
      invoiceInsertResult: { data: { id: 'inv-triggered-1' }, error: null },
    })
    mockCreateSupabaseServerClient.mockResolvedValue(supabase)
    mockGetAuthenticatedHospital.mockResolvedValue(ADMIN)

    const { POST } = await import('@/app/api/timecards/[id]/approve/route')
    const res = await POST(makeApproveRequest(), { params: Promise.resolve({ id: TIMECARD_ID }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    // Route returns invoice_id in response
    expect(body).toHaveProperty('invoice_id')
    // Invoices table was touched
    const fromCalls = (supabase.from as jest.Mock).mock.calls.map(([t]: [string]) => t)
    expect(fromCalls).toContain('invoices')
  })

  test('approve timecard — already approved → 422 conflict', async () => {
    const alreadyApproved = buildTimecardFromMock({ status: 'approved' })
    const supabase = buildSupabaseMock({ timecardData: alreadyApproved })
    mockCreateSupabaseServerClient.mockResolvedValue(supabase)
    mockGetAuthenticatedHospital.mockResolvedValue(ADMIN)

    const { POST } = await import('@/app/api/timecards/[id]/approve/route')
    const res = await POST(makeApproveRequest(), { params: Promise.resolve({ id: TIMECARD_ID }) })
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.error).toMatch(/already/i)
  })

  test('approve timecard — disputed timecard (no clock_out) → cannot approve', async () => {
    // A timecard without clock_out_at represents an open/disputed shift
    const noClockOut = buildTimecardFromMock({ clock_out_at: null })
    const supabase = buildSupabaseMock({ timecardData: noClockOut })
    mockCreateSupabaseServerClient.mockResolvedValue(supabase)
    mockGetAuthenticatedHospital.mockResolvedValue(ADMIN)

    const { POST } = await import('@/app/api/timecards/[id]/approve/route')
    const res = await POST(makeApproveRequest(), { params: Promise.resolve({ id: TIMECARD_ID }) })
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.error).toMatch(/clock-out|clock_out/i)
  })

  test('approve timecard — wrong facility admin → 403', async () => {
    // Timecard belongs to fac-2, but admin is for fac-1
    const otherFacilityTimecard = buildTimecardFromMock({ facility_id: 'fac-2' })
    const supabase = buildSupabaseMock({ timecardData: otherFacilityTimecard })
    mockCreateSupabaseServerClient.mockResolvedValue(supabase)
    mockGetAuthenticatedHospital.mockResolvedValue(ADMIN) // ADMIN.hospitalId = 'fac-1'

    const { POST } = await import('@/app/api/timecards/[id]/approve/route')
    const res = await POST(makeApproveRequest(), { params: Promise.resolve({ id: TIMECARD_ID }) })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/forbidden|different facility/i)
  })
})
