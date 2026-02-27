/**
 * NurseSphere Marketplace Fee Calculator
 *
 * Platform model: 6% application fee on every shift payment.
 * Stripe Connect: Direct Charge — charge happens on the platform account,
 * application_fee_amount is deducted and kept by NurseSphere,
 * remainder is transferred to the nurse's connected account.
 *
 * All monetary values are in cents (integer) as required by Stripe.
 */

/** Platform fee rate: 6% */
export const PLATFORM_FEE_RATE = 0.06

/**
 * Convert a dollar amount to cents (Stripe integer format).
 * Rounds to nearest cent to avoid floating-point drift.
 */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100)
}

/**
 * Convert cents back to dollars for display.
 */
export function toDollars(cents: number): number {
  return cents / 100
}

/**
 * Calculate the platform application fee in cents for a given gross amount.
 *
 * @param grossAmountCents - Total charge amount in cents
 * @returns Application fee in cents (floor to avoid overcharging)
 */
export function calculateApplicationFee(grossAmountCents: number): number {
  return Math.floor(grossAmountCents * PLATFORM_FEE_RATE)
}

/**
 * Calculate the nurse payout in cents after the platform fee.
 *
 * @param grossAmountCents - Total charge amount in cents
 * @returns Net payout to nurse in cents
 */
export function calculateNursePayout(grossAmountCents: number): number {
  return grossAmountCents - calculateApplicationFee(grossAmountCents)
}

/**
 * Full breakdown of a marketplace transaction.
 */
export interface FeeBreakdown {
  /** Original charge amount in cents */
  grossAmountCents: number
  /** Platform fee in cents (6%) */
  applicationFeeCents: number
  /** Net amount transferred to nurse in cents */
  nursePayoutCents: number
  /** Effective fee rate (should equal PLATFORM_FEE_RATE) */
  effectiveFeeRate: number
  /** Human-readable summary */
  summary: {
    grossAmount: string
    applicationFee: string
    nursePayout: string
    feePercentage: string
  }
}

/**
 * Generate a full fee breakdown for a given gross dollar amount.
 *
 * @param grossAmountDollars - Total charge amount in dollars
 * @returns FeeBreakdown object
 */
export function calculateFeeBreakdown(grossAmountDollars: number): FeeBreakdown {
  const grossAmountCents = toCents(grossAmountDollars)
  const applicationFeeCents = calculateApplicationFee(grossAmountCents)
  const nursePayoutCents = calculateNursePayout(grossAmountCents)
  const effectiveFeeRate = grossAmountCents > 0 ? applicationFeeCents / grossAmountCents : 0

  const fmt = (cents: number) =>
    `$${toDollars(cents).toFixed(2)}`

  return {
    grossAmountCents,
    applicationFeeCents,
    nursePayoutCents,
    effectiveFeeRate,
    summary: {
      grossAmount: fmt(grossAmountCents),
      applicationFee: fmt(applicationFeeCents),
      nursePayout: fmt(nursePayoutCents),
      feePercentage: `${(effectiveFeeRate * 100).toFixed(2)}%`,
    },
  }
}

/**
 * Build Stripe Connect transfer parameters for a nurse payout.
 *
 * @param grossAmountDollars  - Total charge in dollars
 * @param nurseStripeAccountId - Nurse's connected Stripe account ID
 * @param metadata - Optional Stripe metadata
 */
export function buildConnectTransferParams(
  grossAmountDollars: number,
  nurseStripeAccountId: string,
  metadata?: Record<string, string>
): {
  amount: number
  destination: string
  application_fee_amount: number
  metadata: Record<string, string>
} {
  const { grossAmountCents, applicationFeeCents } = calculateFeeBreakdown(grossAmountDollars)
  return {
    amount: grossAmountCents,
    destination: nurseStripeAccountId,
    application_fee_amount: applicationFeeCents,
    metadata: metadata ?? {},
  }
}
