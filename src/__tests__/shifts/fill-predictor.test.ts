/**
 * Tests for Shift Fill Predictor scoring engine.
 * Pure functions only — no DB, no network.
 */

import {
  computeAcceptanceProbability,
  computeFitScore,
  computeShiftRisk,
  rankCandidates,
  type NurseInput,
  type ShiftInput,
  type ShiftCandidate,
} from '@/lib/shifts/fill-predictor'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeShift(overrides: Partial<ShiftInput> = {}): ShiftInput {
  return {
    id: 'shift-1',
    facility_id: 'fac-1',
    start_time: new Date(Date.now() + 200 * 60 * 60 * 1000).toISOString(), // 200h from now
    hourly_rate: 80,
    required_credentials: [],
    ...overrides,
  }
}

function makeNurse(overrides: Partial<NurseInput> = {}): NurseInput {
  return {
    id: 'nurse-1',
    compliance_score: 85,
    historical_acceptance_rate: 0.75,
    credentials: [],
    ...overrides,
  }
}

// ─── Tests: computeAcceptanceProbability ──────────────────────────────────────

describe('computeAcceptanceProbability', () => {
  test('shift 200h away, rate competitive → high fill probability', () => {
    const nurse = makeNurse({ historical_acceptance_rate: 0.75 })
    const shift = makeShift({
      start_time: new Date(Date.now() + 200 * 60 * 60 * 1000).toISOString(),
      hourly_rate: 85, // above baseline $75
    })

    const result = computeAcceptanceProbability(nurse, shift, 75)

    expect(result.excluded).toBe(false)
    // 0.75 base × 1.0 timing (>72h) × 1.2 rate (>baseline+10%) × 1.0 compliance = 0.9
    expect(result.score).toBeGreaterThan(0.7)
    expect(result.reasons.timing_factor).toBe(1.0)
    expect(result.reasons.rate_factor).toBe(1.2)
  })

  test('shift 1h away → fill probability reduced by timing factor', () => {
    const nurse = makeNurse({ historical_acceptance_rate: 0.75 })
    const shiftFar = makeShift({
      start_time: new Date(Date.now() + 200 * 60 * 60 * 1000).toISOString(),
    })
    const shiftNear = makeShift({
      start_time: new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(), // 1h away
    })

    const farResult = computeAcceptanceProbability(nurse, shiftFar, 75)
    const nearResult = computeAcceptanceProbability(nurse, shiftNear, 75)

    expect(nearResult.score).toBeLessThan(farResult.score)
    expect(nearResult.reasons.timing_factor).toBe(0.3) // <2h → 0.3x
  })

  test('nurse compliance score < 60 → excluded from candidates', () => {
    const nurse = makeNurse({ compliance_score: 55 })
    const shift = makeShift()

    const result = computeAcceptanceProbability(nurse, shift, 75)

    expect(result.excluded).toBe(true)
    expect(result.score).toBe(0)
    expect(result.exclusion_reason).toBe('compliance_score_below_threshold')
  })

  test('nurse compliance score exactly 60 → NOT excluded', () => {
    const nurse = makeNurse({ compliance_score: 60 })
    const shift = makeShift()

    const result = computeAcceptanceProbability(nurse, shift, 75)

    expect(result.excluded).toBe(false)
    expect(result.score).toBeGreaterThan(0)
  })

  test('nurse compliance >= 90 → 1.1x boost', () => {
    const nurseHigh = makeNurse({ compliance_score: 90, historical_acceptance_rate: 0.6 })
    const nurseLow = makeNurse({ compliance_score: 70, historical_acceptance_rate: 0.6 })
    const shift = makeShift()

    const highResult = computeAcceptanceProbability(nurseHigh, shift, 75)
    const lowResult = computeAcceptanceProbability(nurseLow, shift, 75)

    expect(highResult.score).toBeGreaterThan(lowResult.score)
    expect(highResult.reasons.compliance_factor).toBe(1.1)
    expect(lowResult.reasons.compliance_factor).toBe(1.0)
  })

  test('score clamped to [0, 1]', () => {
    // Very generous parameters → result should not exceed 1
    const nurse = makeNurse({
      compliance_score: 99,
      historical_acceptance_rate: 0.99,
    })
    const shift = makeShift({
      hourly_rate: 200, // way above baseline
      start_time: new Date(Date.now() + 200 * 60 * 60 * 1000).toISOString(),
    })

    const result = computeAcceptanceProbability(nurse, shift, 75)

    expect(result.score).toBeLessThanOrEqual(1.0)
    expect(result.score).toBeGreaterThanOrEqual(0.0)
  })

  test('uses default acceptance rate of 0.6 when no historical data', () => {
    const nurse = makeNurse({ historical_acceptance_rate: null })
    const shift = makeShift({
      start_time: new Date(Date.now() + 200 * 60 * 60 * 1000).toISOString(),
      hourly_rate: 75, // exactly baseline
    })

    const result = computeAcceptanceProbability(nurse, shift, 75)

    expect(result.excluded).toBe(false)
    // 0.6 base × 1.0 timing × 1.0 rate × 1.0 compliance = 0.6
    expect(result.reasons.base_acceptance_rate).toBe(0.6)
    expect(result.score).toBeCloseTo(0.6, 5)
  })
})

// ─── Tests: computeFitScore ───────────────────────────────────────────────────

describe('computeFitScore', () => {
  test('no required credentials → fit = 1.0', () => {
    expect(computeFitScore(['RN', 'BLS'], [])).toBe(1.0)
  })

  test('full credential match → fit = 1.0', () => {
    expect(computeFitScore(['RN', 'BLS', 'ACLS'], ['RN', 'BLS'])).toBe(1.0)
  })

  test('partial match → correct ratio', () => {
    const fit = computeFitScore(['RN'], ['RN', 'BLS', 'ACLS'])
    expect(fit).toBeCloseTo(1 / 3, 5)
  })

  test('no match → fit = 0', () => {
    expect(computeFitScore(['PEDS'], ['RN', 'BLS'])).toBe(0)
  })

  test('case-insensitive matching', () => {
    expect(computeFitScore(['rn', 'bls'], ['RN', 'BLS'])).toBe(1.0)
  })
})

// ─── Tests: computeShiftRisk ──────────────────────────────────────────────────

describe('computeShiftRisk: risk_level correctly derived from fill_probability', () => {
  const shift = makeShift()

  function makeCandidates(scores: number[]): ShiftCandidate[] {
    return scores.map((score, i) => ({
      nurse_id: `nurse-${i}`,
      shift_id: shift.id,
      facility_id: shift.facility_id,
      score_accept: score,
      score_fit: 1.0,
      rank: i + 1,
      reasons: {
        timing_factor: 1.0,
        rate_factor: 1.0,
        compliance_factor: 1.0,
        base_acceptance_rate: score,
      },
    }))
  }

  test('fill_probability > 0.7 → risk_level = low', () => {
    const candidates = makeCandidates([0.8, 0.85, 0.9, 0.75, 0.8])
    const risk = computeShiftRisk(shift, candidates)
    expect(risk.risk_level).toBe('low')
    expect(risk.fill_probability).toBeGreaterThan(0.7)
    expect(risk.recommended_rate_delta).toBe(0)
  })

  test('0.4 <= fill_probability <= 0.7 → risk_level = medium', () => {
    const candidates = makeCandidates([0.5, 0.55, 0.6, 0.5, 0.55])
    const risk = computeShiftRisk(shift, candidates)
    expect(risk.risk_level).toBe('medium')
    expect(risk.fill_probability).toBeGreaterThanOrEqual(0.4)
    expect(risk.fill_probability).toBeLessThanOrEqual(0.7)
  })

  test('fill_probability < 0.4 → risk_level = high', () => {
    const candidates = makeCandidates([0.2, 0.25, 0.3, 0.15, 0.2])
    const risk = computeShiftRisk(shift, candidates)
    expect(risk.risk_level).toBe('high')
    expect(risk.fill_probability).toBeLessThan(0.4)
    expect(risk.recommended_rate_delta).toBeGreaterThan(0)
    expect(risk.recommended_actions).toContain('boost_rate')
  })

  test('no candidates → very high risk', () => {
    const risk = computeShiftRisk(shift, [])
    expect(risk.risk_level).toBe('high')
    expect(risk.fill_probability).toBeLessThan(0.4)
  })

  test('uses only top-5 candidates for probability calculation', () => {
    // First 5 have low scores, rest have high — should still be high risk
    const candidates = makeCandidates([0.1, 0.2, 0.15, 0.1, 0.2, 0.9, 0.95, 0.9])
    const risk = computeShiftRisk(shift, candidates)
    // avg of first 5 = 0.15 → high risk
    expect(risk.risk_level).toBe('high')
  })
})

// ─── Tests: rankCandidates ────────────────────────────────────────────────────

describe('rankCandidates', () => {
  const shift = makeShift({ required_credentials: ['RN', 'BLS'] })

  test('excludes nurses with compliance < 60', () => {
    const nurses: NurseInput[] = [
      makeNurse({ id: 'n1', compliance_score: 55, credentials: ['RN', 'BLS'] }),
      makeNurse({ id: 'n2', compliance_score: 80, credentials: ['RN', 'BLS'] }),
    ]
    const candidates = rankCandidates(shift, nurses)
    const ids = candidates.map(c => c.nurse_id)
    expect(ids).not.toContain('n1')
    expect(ids).toContain('n2')
  })

  test('returns at most 20 candidates', () => {
    const nurses = Array.from({ length: 30 }, (_, i) =>
      makeNurse({ id: `n${i}`, compliance_score: 70 })
    )
    const candidates = rankCandidates(shift, nurses)
    expect(candidates.length).toBeLessThanOrEqual(20)
  })

  test('sorts by composite score descending', () => {
    const nurses: NurseInput[] = [
      makeNurse({ id: 'low', compliance_score: 61, historical_acceptance_rate: 0.3, credentials: [] }),
      makeNurse({ id: 'high', compliance_score: 95, historical_acceptance_rate: 0.9, credentials: ['RN', 'BLS'] }),
    ]
    const candidates = rankCandidates(shift, nurses)
    expect(candidates[0].nurse_id).toBe('high')
    expect(candidates[0].rank).toBe(1)
  })

  test('assigns sequential ranks starting at 1', () => {
    const nurses = Array.from({ length: 5 }, (_, i) =>
      makeNurse({ id: `n${i}`, compliance_score: 70 })
    )
    const candidates = rankCandidates(shift, nurses)
    const ranks = candidates.map(c => c.rank)
    ranks.forEach((r, i) => expect(r).toBe(i + 1))
  })
})
