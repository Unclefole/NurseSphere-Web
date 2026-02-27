/**
 * NurseSphere Timecard Calculations
 * Pure functions for timecard hour and pay calculations.
 * No DB calls — safe to use in both server and client contexts.
 */

export type TimecardStatus = 'pending' | 'submitted' | 'approved' | 'rejected' | 'disputed'

export interface TimecardInput {
  clock_in: string | null   // ISO datetime string
  clock_out: string | null  // ISO datetime string
  break_minutes?: number    // optional break deduction in minutes
  status?: TimecardStatus
}

export interface TimecardCalculation {
  total_hours: number | null   // null if clock_out is missing
  gross_minutes: number | null // minutes worked before break deduction
  break_minutes: number
  net_minutes: number | null   // net minutes (gross - break)
}

/**
 * calculateTotalHours
 *
 * Computes total hours worked, accounting for break deductions.
 * Returns null if clock_out is not provided (shift still in progress).
 *
 * @param input TimecardInput
 * @returns Rounded total hours (2 decimal places), or null if incomplete
 */
export function calculateTotalHours(input: TimecardInput): number | null {
  if (!input.clock_in || !input.clock_out) return null

  const clockIn = new Date(input.clock_in)
  const clockOut = new Date(input.clock_out)

  if (isNaN(clockIn.getTime()) || isNaN(clockOut.getTime())) return null
  if (clockOut <= clockIn) return null

  const grossMinutes = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60)
  const breakMinutes = input.break_minutes ?? 0
  const netMinutes = Math.max(0, grossMinutes - breakMinutes)

  return Math.round((netMinutes / 60) * 100) / 100
}

/**
 * calculateTimecardDetails
 *
 * Returns full calculation breakdown for a timecard.
 */
export function calculateTimecardDetails(input: TimecardInput): TimecardCalculation {
  if (!input.clock_in || !input.clock_out) {
    return {
      total_hours: null,
      gross_minutes: null,
      break_minutes: input.break_minutes ?? 0,
      net_minutes: null,
    }
  }

  const clockIn = new Date(input.clock_in)
  const clockOut = new Date(input.clock_out)

  if (isNaN(clockIn.getTime()) || isNaN(clockOut.getTime()) || clockOut <= clockIn) {
    return {
      total_hours: null,
      gross_minutes: null,
      break_minutes: input.break_minutes ?? 0,
      net_minutes: null,
    }
  }

  const grossMinutes = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60)
  const breakMinutes = input.break_minutes ?? 0
  const netMinutes = Math.max(0, grossMinutes - breakMinutes)
  const totalHours = Math.round((netMinutes / 60) * 100) / 100

  return {
    total_hours: totalHours,
    gross_minutes: grossMinutes,
    break_minutes: breakMinutes,
    net_minutes: netMinutes,
  }
}

/**
 * canSubmitTimecard
 *
 * Validates whether a timecard can be submitted.
 * Returns true only if status is 'pending' (not yet submitted).
 * Submitted timecards cannot be re-submitted.
 */
export function canSubmitTimecard(status: TimecardStatus): boolean {
  return status === 'pending'
}

/**
 * validateTimecardSubmission
 *
 * Full validation for timecard submission.
 * Returns a list of validation errors (empty = valid).
 */
export function validateTimecardSubmission(input: TimecardInput): string[] {
  const errors: string[] = []

  if (!input.clock_in) {
    errors.push('clock_in is required')
  }
  if (!input.clock_out) {
    errors.push('clock_out is required to submit')
  }

  if (input.clock_in && input.clock_out) {
    const clockIn = new Date(input.clock_in)
    const clockOut = new Date(input.clock_out)

    if (isNaN(clockIn.getTime())) errors.push('clock_in is not a valid datetime')
    if (isNaN(clockOut.getTime())) errors.push('clock_out is not a valid datetime')
    if (!isNaN(clockIn.getTime()) && !isNaN(clockOut.getTime()) && clockOut <= clockIn) {
      errors.push('clock_out must be after clock_in')
    }
  }

  if (input.status && !canSubmitTimecard(input.status)) {
    errors.push(`Cannot submit a timecard with status '${input.status}'`)
  }

  return errors
}
