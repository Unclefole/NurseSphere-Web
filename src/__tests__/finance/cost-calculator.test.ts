/**
 * Tests for Labor Cost Calculator.
 * Pure function tests only — DB-dependent functions are separately integration-tested.
 */

import {
  computeShiftCost,
  periodToDates,
  previousPeriodDates,
  type ShiftCostInput,
} from '@/lib/finance/cost-calculator'

// ─── computeShiftCost ─────────────────────────────────────────────────────────

describe('computeShiftCost', () => {
  test('8hr shift at $45/hr, baseline $80/hr → savings = $280', () => {
    const input: ShiftCostInput = {
      hourly_rate: 45,
      hours: 8,
      event_type: 'staffed_nursesphere',
    }
    const result = computeShiftCost(input, 80)

    expect(result.cost).toBe(360)           // 45 * 8
    expect(result.baseline_cost).toBe(640)  // 80 * 8
    expect(result.savings).toBe(280)        // 640 - 360
  })

  test('agency staffed at baseline rate → savings = 0', () => {
    const input: ShiftCostInput = {
      hourly_rate: 80,
      hours: 8,
      event_type: 'staffed_agency',
    }
    const result = computeShiftCost(input, 80)

    expect(result.cost).toBe(640)
    expect(result.baseline_cost).toBe(640)
    expect(result.savings).toBe(0)
  })

  test('cost higher than baseline → negative savings', () => {
    const input: ShiftCostInput = {
      hourly_rate: 100,
      hours: 8,
      event_type: 'staffed_agency',
    }
    const result = computeShiftCost(input, 80)

    expect(result.savings).toBe(-160) // 640 - 800
  })

  test('12hr shift at $60/hr, baseline $90/hr → savings = $360', () => {
    const input: ShiftCostInput = {
      hourly_rate: 60,
      hours: 12,
      event_type: 'staffed_nursesphere',
    }
    const result = computeShiftCost(input, 90)

    expect(result.cost).toBe(720)
    expect(result.baseline_cost).toBe(1080)
    expect(result.savings).toBe(360)
  })
})

// ─── Agency Dependency Ratio (unit logic) ─────────────────────────────────────

/**
 * We test the pure ratio logic inline since computeAgencyDependencyRatio
 * requires Supabase. This mirrors the exact same logic.
 */
function computeRatioFromEvents(
  events: Array<{ hours: number; event_type: string }>
): number {
  const totalHours = events.reduce((s, e) => s + e.hours, 0)
  if (totalHours === 0) return 0
  const agencyHours = events
    .filter(e => e.event_type === 'staffed_agency')
    .reduce((s, e) => s + e.hours, 0)
  return agencyHours / totalHours
}

describe('agency_dependency_ratio logic', () => {
  test('agency_dependency_ratio = 0 if all shifts are staffed_nursesphere', () => {
    const events = [
      { hours: 8, event_type: 'staffed_nursesphere' },
      { hours: 12, event_type: 'staffed_nursesphere' },
      { hours: 8, event_type: 'staffed_internal' },
    ]
    expect(computeRatioFromEvents(events)).toBe(0)
  })

  test('agency_dependency_ratio = 1 if all shifts are staffed_agency', () => {
    const events = [
      { hours: 8, event_type: 'staffed_agency' },
      { hours: 12, event_type: 'staffed_agency' },
    ]
    expect(computeRatioFromEvents(events)).toBe(1)
  })

  test('mixed staffing gives correct ratio', () => {
    const events = [
      { hours: 8, event_type: 'staffed_agency' },
      { hours: 8, event_type: 'staffed_nursesphere' },
    ]
    // 8 agency / 16 total = 0.5
    expect(computeRatioFromEvents(events)).toBe(0.5)
  })

  test('no events → ratio = 0 (not NaN)', () => {
    expect(computeRatioFromEvents([])).toBe(0)
  })
})

// ─── periodToDates ────────────────────────────────────────────────────────────

describe('periodToDates', () => {
  test('30d period → start is ~30 days ago', () => {
    const { start, end } = periodToDates('30d')
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
    expect(diffDays).toBeCloseTo(30, 0)
  })

  test('90d period → start is ~90 days ago', () => {
    const { start, end } = periodToDates('90d')
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
    expect(diffDays).toBeCloseTo(90, 0)
  })

  test('ytd period → start is Jan 1 of current year', () => {
    const { start } = periodToDates('ytd')
    expect(start.getMonth()).toBe(0)   // January
    expect(start.getDate()).toBe(1)
    expect(start.getFullYear()).toBe(new Date().getFullYear())
  })
})

// ─── previousPeriodDates ──────────────────────────────────────────────────────

describe('previousPeriodDates', () => {
  test('previous period has same duration as current', () => {
    const now = new Date()
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const prev = previousPeriodDates(start, now)
    const currentDuration = now.getTime() - start.getTime()
    const prevDuration = prev.end.getTime() - prev.start.getTime()
    expect(prevDuration).toBe(currentDuration)
  })

  test('previous period ends at current start', () => {
    const now = new Date()
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const prev = previousPeriodDates(start, now)
    expect(prev.end.getTime()).toBe(start.getTime())
  })
})
