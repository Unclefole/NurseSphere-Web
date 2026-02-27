/**
 * Shift Fill Predictor — MODULE 2
 * Heuristic scoring engine: no ML, weighted rule-based.
 * HIPAA: PHI never logged. facility_id always scoped.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NurseInput {
  id: string
  compliance_score: number          // 0-100
  historical_acceptance_rate: number | null  // 0-1, or null if unknown
  credentials: string[]             // list of credential type slugs
}

export interface ShiftInput {
  id: string
  facility_id: string
  start_time: string                // ISO timestamp
  hourly_rate: number
  required_credentials: string[]   // credential slugs required
}

export interface AcceptanceResult {
  score: number         // 0-1 clamped
  reasons: AcceptanceReasons
  excluded: boolean
  exclusion_reason?: string
}

export interface AcceptanceReasons {
  timing_factor: number
  rate_factor: number
  compliance_factor: number
  base_acceptance_rate: number
}

export interface ShiftCandidate {
  nurse_id: string
  shift_id: string
  facility_id: string
  score_accept: number
  score_fit: number
  rank: number
  reasons: AcceptanceReasons
}

export interface ShiftRisk {
  shift_id: string
  facility_id: string
  fill_probability: number
  risk_level: 'low' | 'medium' | 'high'
  recommended_rate_delta: number
  recommended_actions: string[]
  computed_at: string
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_ACCEPTANCE_RATE = 0.6
const DEFAULT_AGENCY_BASELINE_RATE = 75 // $/hr — used when no cost_baseline found
const TOP_CANDIDATES = 20
const TOP_CANDIDATES_FOR_RISK = 5

// ─── Timing Factor ───────────────────────────────────────────────────────────

/**
 * Returns a multiplier based on how many hours until the shift starts.
 * Closer shifts are less likely to be accepted (less time to plan).
 */
function timingFactor(shiftStartIso: string): number {
  const now = Date.now()
  const shiftMs = new Date(shiftStartIso).getTime()
  const hoursUntil = (shiftMs - now) / (1000 * 60 * 60)

  if (hoursUntil < 2) return 0.3
  if (hoursUntil < 24) return 0.7
  if (hoursUntil >= 72) return 1.0
  // Linear interpolation between 24h and 72h: 0.7 → 1.0
  return 0.7 + ((hoursUntil - 24) / (72 - 24)) * 0.3
}

// ─── Rate Competitiveness Factor ──────────────────────────────────────────────

/**
 * Returns multiplier based on how competitive the shift rate is vs facility baseline.
 */
function rateFactor(shiftRate: number, baselineRate: number): number {
  const ratio = shiftRate / baselineRate
  if (ratio >= 1.1) return 1.2  // >= baseline+10%
  if (ratio < 0.9) return 0.7   // < baseline-10%
  return 1.0                     // within ±10%
}

// ─── Compliance Factor ────────────────────────────────────────────────────────

/**
 * Returns multiplier for nurse compliance score. Score < 60 → excluded.
 */
function complianceFactor(score: number): number {
  if (score >= 90) return 1.1
  return 1.0
}

// ─── Fit Score (Credential Match) ─────────────────────────────────────────────

/**
 * Ratio of required credentials the nurse holds.
 * If shift requires no credentials, fit = 1.0.
 */
export function computeFitScore(
  nurseCredentials: string[],
  requiredCredentials: string[]
): number {
  if (requiredCredentials.length === 0) return 1.0
  const nurseSet = new Set(nurseCredentials.map(c => c.toLowerCase()))
  const matched = requiredCredentials.filter(c => nurseSet.has(c.toLowerCase())).length
  return matched / requiredCredentials.length
}

// ─── Acceptance Probability ───────────────────────────────────────────────────

/**
 * Compute the probability (0-1) that a nurse will accept a given shift.
 *
 * Formula: base_acceptance_rate × timing_factor × rate_factor × compliance_factor
 * Clamped to [0, 1].
 */
export function computeAcceptanceProbability(
  nurse: NurseInput,
  shift: ShiftInput,
  facilityBaselineRate: number = DEFAULT_AGENCY_BASELINE_RATE
): AcceptanceResult {
  // Exclude nurses with compliance score < 60
  if (nurse.compliance_score < 60) {
    return {
      score: 0,
      excluded: true,
      exclusion_reason: 'compliance_score_below_threshold',
      reasons: {
        timing_factor: 0,
        rate_factor: 0,
        compliance_factor: 0,
        base_acceptance_rate: 0,
      },
    }
  }

  const baseRate = nurse.historical_acceptance_rate ?? DEFAULT_ACCEPTANCE_RATE
  const tf = timingFactor(shift.start_time)
  const rf = rateFactor(shift.hourly_rate, facilityBaselineRate)
  const cf = complianceFactor(nurse.compliance_score)

  const raw = baseRate * tf * rf * cf
  const score = Math.min(1, Math.max(0, raw))

  return {
    score,
    excluded: false,
    reasons: {
      timing_factor: tf,
      rate_factor: rf,
      compliance_factor: cf,
      base_acceptance_rate: baseRate,
    },
  }
}

// ─── Rank Candidates ──────────────────────────────────────────────────────────

/**
 * Given a pool of nurses, compute acceptance + fit scores, sort by composite,
 * and return top N candidates (default 20).
 */
export function rankCandidates(
  shift: ShiftInput,
  nurses: NurseInput[],
  facilityBaselineRate: number = DEFAULT_AGENCY_BASELINE_RATE,
  limit: number = TOP_CANDIDATES
): ShiftCandidate[] {
  const scored: Array<ShiftCandidate & { composite: number }> = []

  for (const nurse of nurses) {
    const acceptance = computeAcceptanceProbability(nurse, shift, facilityBaselineRate)
    if (acceptance.excluded) continue

    const fitScore = computeFitScore(nurse.credentials, shift.required_credentials)
    const composite = acceptance.score * fitScore

    scored.push({
      nurse_id: nurse.id,
      shift_id: shift.id,
      facility_id: shift.facility_id,
      score_accept: acceptance.score,
      score_fit: fitScore,
      rank: 0,           // assigned after sort
      reasons: acceptance.reasons,
      composite,
    })
  }

  // Sort descending by composite score
  scored.sort((a, b) => b.composite - a.composite)

  return scored.slice(0, limit).map((c, idx) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { composite, ...candidate } = c
    return { ...candidate, rank: idx + 1 }
  })
}

// ─── Shift Risk ───────────────────────────────────────────────────────────────

/**
 * Compute the fill risk for a shift based on ranked candidate scores.
 *
 * fill_probability = average acceptance score of top-5 candidates.
 * risk_level: >0.7 → low, 0.4-0.7 → medium, <0.4 → high.
 * recommended_rate_delta: if high risk, suggests +$5-15/hr based on gap to 0.4.
 */
export function computeShiftRisk(
  shift: ShiftInput,
  candidates: ShiftCandidate[],
  facilityBaselineRate: number = DEFAULT_AGENCY_BASELINE_RATE
): ShiftRisk {
  const top5 = candidates.slice(0, TOP_CANDIDATES_FOR_RISK)
  const fillProbability =
    top5.length === 0
      ? 0.1  // no candidates at all → very high risk
      : top5.reduce((sum, c) => sum + c.score_accept, 0) / top5.length

  let riskLevel: 'low' | 'medium' | 'high'
  if (fillProbability > 0.7) riskLevel = 'low'
  else if (fillProbability >= 0.4) riskLevel = 'medium'
  else riskLevel = 'high'

  let recommendedRateDelta = 0
  const recommendedActions: string[] = ['notify_top_candidates']

  if (riskLevel === 'high') {
    // Gap to reach medium threshold (0.4), mapped to $5-15 range
    const gap = 0.4 - fillProbability  // 0 to 0.4
    recommendedRateDelta = Math.round(5 + (gap / 0.4) * 10)  // $5 to $15
    recommendedActions.push('boost_rate', 'expand_radius')
  } else if (riskLevel === 'medium') {
    recommendedRateDelta = 5
    recommendedActions.push('expand_radius')
  }

  return {
    shift_id: shift.id,
    facility_id: shift.facility_id,
    fill_probability: Math.min(1, Math.max(0, fillProbability)),
    risk_level: riskLevel,
    recommended_rate_delta: recommendedRateDelta,
    recommended_actions: recommendedActions,
    computed_at: new Date().toISOString(),
  }
}

// ─── Re-export helpers ────────────────────────────────────────────────────────

export { DEFAULT_AGENCY_BASELINE_RATE }
