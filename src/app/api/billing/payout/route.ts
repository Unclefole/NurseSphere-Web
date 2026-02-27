/**
 * POST /api/billing/payout
 *
 * Triggers a payout to a nurse via Stripe Connect.
 *
 * Flow:
 *   1. Validate hospital auth
 *   2. Look up nurse profile → check stripe_account_id
 *   3. If not onboarded → return 422 with onboarding_url
 *   4. Calculate 6% platform fee, transfer remainder to nurse
 *   5. Audit log the transfer
 */
import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe/client'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'
import { calculateFeeBreakdown } from '@/lib/stripe/fee-calculator'
import { parseAndValidate, payoutSchema } from '@/lib/validation/schemas'

interface PayoutBody {
  /** Nurse's user ID (must match a profile with stripe_account_id) */
  nurse_id: string
  /** Gross payout amount in dollars */
  amount: number
  /** Optional context (e.g., shift ID being paid out) */
  shift_id?: string
  description?: string
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Zod input validation — returns 400 with structured field errors on failure
    const [body, validationError] = await parseAndValidate(payoutSchema, request)
    if (validationError) return validationError as unknown as NextResponse

    const { nurse_id, amount, shift_id, description } = body

    // Fetch nurse profile — check for connected Stripe account
    const { data: nurseProfile, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, stripe_account_id, stripe_onboarding_complete')
      .eq('id', nurse_id)
      .eq('role', 'nurse')
      .single()

    if (profileError || !nurseProfile) {
      return NextResponse.json({ error: 'Nurse not found' }, { status: 404 })
    }

    const stripeAccountId: string | null = (nurseProfile as any).stripe_account_id ?? null
    const onboardingComplete: boolean = (nurseProfile as any).stripe_onboarding_complete ?? false

    // If nurse is not onboarded, generate an onboarding link and return 422
    if (!stripeAccountId || !onboardingComplete) {
      const stripe = getStripe()

      let accountId = stripeAccountId
      if (!accountId) {
        // Create a Connect express account for the nurse
        const account = await stripe.accounts.create({
          type: 'express',
          country: 'US',
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          metadata: {
            nurse_id,
            platform: 'nursesphere',
          },
        })
        accountId = account.id

        // Persist the account ID on the nurse's profile
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from('profiles').update({ stripe_account_id: accountId }).eq('id', nurse_id)
      }

      // Generate onboarding link
      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://nursesphere.app'}/nurse/billing/onboarding?refresh=1`,
        return_url: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://nursesphere.app'}/nurse/billing/onboarding?success=1`,
        type: 'account_onboarding',
      })

      return NextResponse.json(
        {
          error: 'Nurse has not completed Stripe onboarding',
          onboarding_required: true,
          onboarding_url: accountLink.url,
          stripe_account_id: accountId,
        },
        { status: 422 }
      )
    }

    // Calculate fee breakdown
    const feeBreakdown = calculateFeeBreakdown(amount)

    const stripe = getStripe()

    // Fetch hospital's Stripe customer ID for the charge source
    const { data: facility } = await supabase
      .from('facilities')
      .select('stripe_customer_id')
      .eq('id', auth.hospitalId)
      .single()

    const stripeCustomerId: string = (facility as any)?.stripe_customer_id ?? ''
    if (!stripeCustomerId) {
      return NextResponse.json(
        { error: 'Hospital has no Stripe customer configured' },
        { status: 422 }
      )
    }

    // Create a PaymentIntent with application_fee_amount for Connect
    const paymentIntent = await stripe.paymentIntents.create({
      amount: feeBreakdown.grossAmountCents,
      currency: 'usd',
      customer: stripeCustomerId,
      application_fee_amount: feeBreakdown.applicationFeeCents,
      transfer_data: {
        destination: stripeAccountId,
      },
      off_session: true,
      confirm: true,
      metadata: {
        nurse_id,
        facility_id: auth.hospitalId,
        shift_id: shift_id ?? '',
        platform_fee_cents: String(feeBreakdown.applicationFeeCents),
        nurse_payout_cents: String(feeBreakdown.nursePayoutCents),
        platform: 'nursesphere',
      },
      description: description ?? `NurseSphere payout to nurse ${nurse_id}`,
    })

    // Audit log the transfer
    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: auth.userId,
      action: 'billing.payout.initiated',
      target_type: 'stripe_payment_intent',
      target_id: paymentIntent.id,
      facility_id: auth.hospitalId,
      metadata: {
        nurse_id,
        nurse_stripe_account: stripeAccountId,
        gross_amount_cents: feeBreakdown.grossAmountCents,
        platform_fee_cents: feeBreakdown.applicationFeeCents,
        nurse_payout_cents: feeBreakdown.nursePayoutCents,
        shift_id: shift_id ?? null,
        payment_intent_status: paymentIntent.status,
        fee_summary: feeBreakdown.summary,
      },
      ip_address,
    })

    return NextResponse.json({
      success: true,
      payment_intent_id: paymentIntent.id,
      status: paymentIntent.status,
      fee_breakdown: feeBreakdown.summary,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Payout] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
