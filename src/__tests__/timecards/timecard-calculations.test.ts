/**
 * Tests for timecard calculation utilities.
 * Pure functions only — no DB or network.
 */

import {
  calculateTotalHours,
  calculateTimecardDetails,
  canSubmitTimecard,
  validateTimecardSubmission,
  type TimecardInput,
  type TimecardStatus,
} from '@/lib/timecards/timecard-calculations'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeClockIn(hoursAgo: number): string {
  const d = new Date(Date.now() - hoursAgo * 60 * 60 * 1000)
  return d.toISOString()
}

function makeClockOut(hoursFromNow: number): string {
  const d = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000)
  return d.toISOString()
}

// Fixed reference times for deterministic tests
const CLOCK_IN_8H = '2026-02-24T08:00:00.000Z'   // 08:00
const CLOCK_OUT_8H = '2026-02-24T16:00:00.000Z'  // 16:00 (8 hours later)

// ─── calculateTotalHours ──────────────────────────────────────────────────────

describe('calculateTotalHours', () => {
  test('8hr shift with 30min break → total_hours = 7.5', () => {
    const input: TimecardInput = {
      clock_in: CLOCK_IN_8H,
      clock_out: CLOCK_OUT_8H,
      break_minutes: 30,
    }

    const result = calculateTotalHours(input)

    expect(result).toBe(7.5)
  })

  test('8hr shift with no break → total_hours = 8', () => {
    const input: TimecardInput = {
      clock_in: CLOCK_IN_8H,
      clock_out: CLOCK_OUT_8H,
      break_minutes: 0,
    }

    const result = calculateTotalHours(input)

    expect(result).toBe(8)
  })

  test('12hr shift with 60min break → total_hours = 11', () => {
    const input: TimecardInput = {
      clock_in: '2026-02-24T06:00:00.000Z',
      clock_out: '2026-02-24T18:00:00.000Z',
      break_minutes: 60,
    }

    const result = calculateTotalHours(input)

    expect(result).toBe(11)
  })

  test('clock_in without clock_out → total_hours = null', () => {
    const input: TimecardInput = {
      clock_in: CLOCK_IN_8H,
      clock_out: null,
    }

    const result = calculateTotalHours(input)

    expect(result).toBeNull()
  })

  test('clock_out without clock_in → total_hours = null', () => {
    const input: TimecardInput = {
      clock_in: null,
      clock_out: CLOCK_OUT_8H,
    }

    const result = calculateTotalHours(input)

    expect(result).toBeNull()
  })

  test('both null → total_hours = null', () => {
    const input: TimecardInput = {
      clock_in: null,
      clock_out: null,
    }

    const result = calculateTotalHours(input)

    expect(result).toBeNull()
  })

  test('clock_out before clock_in → total_hours = null (invalid)', () => {
    const input: TimecardInput = {
      clock_in: CLOCK_OUT_8H,  // swapped
      clock_out: CLOCK_IN_8H,
    }

    const result = calculateTotalHours(input)

    expect(result).toBeNull()
  })
})

// ─── calculateTimecardDetails ─────────────────────────────────────────────────

describe('calculateTimecardDetails', () => {
  test('returns full breakdown for completed shift', () => {
    const input: TimecardInput = {
      clock_in: CLOCK_IN_8H,
      clock_out: CLOCK_OUT_8H,
      break_minutes: 30,
    }

    const result = calculateTimecardDetails(input)

    expect(result.total_hours).toBe(7.5)
    expect(result.gross_minutes).toBe(480)    // 8 hours = 480 min
    expect(result.break_minutes).toBe(30)
    expect(result.net_minutes).toBe(450)      // 480 - 30
  })

  test('returns nulls for incomplete timecard', () => {
    const result = calculateTimecardDetails({ clock_in: CLOCK_IN_8H, clock_out: null })

    expect(result.total_hours).toBeNull()
    expect(result.gross_minutes).toBeNull()
    expect(result.net_minutes).toBeNull()
    expect(result.break_minutes).toBe(0)
  })
})

// ─── canSubmitTimecard ────────────────────────────────────────────────────────

describe('canSubmitTimecard', () => {
  test('pending status → can submit', () => {
    expect(canSubmitTimecard('pending')).toBe(true)
  })

  test('submitted timecard cannot be re-submitted', () => {
    expect(canSubmitTimecard('submitted')).toBe(false)
  })

  test('approved timecard cannot be submitted', () => {
    expect(canSubmitTimecard('approved')).toBe(false)
  })

  test('rejected timecard cannot be submitted (must be reset first)', () => {
    expect(canSubmitTimecard('rejected')).toBe(false)
  })

  test('disputed timecard cannot be submitted', () => {
    expect(canSubmitTimecard('disputed')).toBe(false)
  })
})

// ─── validateTimecardSubmission ───────────────────────────────────────────────

describe('validateTimecardSubmission', () => {
  test('valid pending timecard with clock_in and clock_out → no errors', () => {
    const input: TimecardInput = {
      clock_in: CLOCK_IN_8H,
      clock_out: CLOCK_OUT_8H,
      status: 'pending',
    }

    const errors = validateTimecardSubmission(input)

    expect(errors).toHaveLength(0)
  })

  test('submitted timecard → cannot re-submit error', () => {
    const input: TimecardInput = {
      clock_in: CLOCK_IN_8H,
      clock_out: CLOCK_OUT_8H,
      status: 'submitted',
    }

    const errors = validateTimecardSubmission(input)

    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some(e => e.includes('submitted'))).toBe(true)
  })

  test('missing clock_out → validation error', () => {
    const input: TimecardInput = {
      clock_in: CLOCK_IN_8H,
      clock_out: null,
      status: 'pending',
    }

    const errors = validateTimecardSubmission(input)

    expect(errors.some(e => e.includes('clock_out'))).toBe(true)
  })
})
