/**
 * payment-guard.ts
 *
 * Server-side guard: checks whether a facility has a valid, active payment method
 * configured in Stripe before allowing shift creation.
 *
 * Usage:
 *   const hasPayment = await hasValidPaymentMethod(facilityId);
 *   if (!hasPayment) return 402 response;
 */
import { getStripe } from '@/lib/stripe/client'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

/**
 * Returns true if the facility has an active Stripe customer with
 * at least one attached payment method.
 */
export async function hasValidPaymentMethod(facilityId: string): Promise<boolean> {
  try {
    const supabase = createSupabaseAdminClient()

    // Fetch facility's Stripe customer ID + payment method status
    const { data: facilityRaw, error } = await (supabase as any)
      .from('facilities')
      .select('stripe_customer_id, payment_method_status, default_payment_method_id')
      .eq('id', facilityId)
      .single()

    if (error || !facilityRaw) return false

    const facility = facilityRaw as {
      stripe_customer_id: string | null
      payment_method_status: string | null
      default_payment_method_id: string | null
    }

    // Quick path: DB already marks it active and we have a default PM
    if (
      facility.payment_method_status === 'active' &&
      facility.default_payment_method_id &&
      facility.stripe_customer_id
    ) {
      // Optionally verify with Stripe that the PM still exists (live check)
      try {
        const stripe = getStripe()
        const pm = await stripe.paymentMethods.retrieve(facility.default_payment_method_id)
        return pm.id === facility.default_payment_method_id
      } catch {
        // If Stripe call fails, fall through to list check
      }
    }

    // No customer at all → no payment method
    if (!facility.stripe_customer_id) return false

    // Live check: list payment methods on the Stripe customer
    const stripe = getStripe()
    const paymentMethods = await stripe.paymentMethods.list({
      customer: facility.stripe_customer_id,
      type: 'card',
      limit: 1,
    })

    const hasMethod = (paymentMethods.data?.length ?? 0) > 0

    // Sync the DB status if it's out of date
    if (hasMethod && facility.payment_method_status !== 'active') {
      await (supabase as any)
        .from('facilities')
        .update({
          payment_method_status: 'active',
          default_payment_method_id: paymentMethods.data[0].id,
        })
        .eq('id', facilityId)
    }

    return hasMethod
  } catch (err) {
    console.error('[PaymentGuard] Error checking payment method:', err)
    // Fail closed — do not allow shift creation if we can't verify
    return false
  }
}
