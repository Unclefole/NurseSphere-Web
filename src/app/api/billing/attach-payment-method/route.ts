/**
 * POST /api/billing/attach-payment-method
 *
 * Attaches a Stripe PaymentMethod to the hospital's Stripe customer.
 * Sets it as the default payment method.
 * Updates the facilities table with payment_method_status = 'active'.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe/client'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'
import { parseAndValidate, attachPaymentMethodSchema } from '@/lib/validation/schemas'

interface AttachPaymentMethodBody {
  payment_method_id: string
  setup_intent_id?: string
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Zod input validation
    const [body, validationError] = await parseAndValidate(attachPaymentMethodSchema, request)
    if (validationError) return validationError as unknown as NextResponse

    const { payment_method_id, setup_intent_id } = body

    // Fetch facility's Stripe customer ID
    const { data: facility, error: facilityError } = await supabase
      .from('facilities')
      .select('id, stripe_customer_id')
      .eq('id', auth.hospitalId)
      .single()

    if (facilityError || !facility) {
      return NextResponse.json({ error: 'Facility not found' }, { status: 404 })
    }

    const stripeCustomerId: string = (facility as any).stripe_customer_id
    if (!stripeCustomerId) {
      return NextResponse.json(
        { error: 'No Stripe customer found. Create a setup intent first.' },
        { status: 422 }
      )
    }

    const stripe = getStripe()

    // Verify the payment method belongs to this customer (ownership validation)
    const pm = await stripe.paymentMethods.retrieve(payment_method_id)
    if (pm.customer && pm.customer !== stripeCustomerId) {
      return NextResponse.json(
        { error: 'Payment method does not belong to this account' },
        { status: 403 }
      )
    }

    // Attach payment method to customer (idempotent if already attached)
    if (!pm.customer) {
      await stripe.paymentMethods.attach(payment_method_id, {
        customer: stripeCustomerId,
      })
    }

    // Set as default payment method on the customer
    await stripe.customers.update(stripeCustomerId, {
      invoice_settings: {
        default_payment_method: payment_method_id,
      },
    })

    // Update facilities table: mark payment method as active
    const updatePayload: Record<string, unknown> = {
      payment_method_status: 'active',
      default_payment_method_id: payment_method_id,
      updated_at: new Date().toISOString(),
    }

    // Cast supabase client to any to bypass generated-type mismatch for
    // runtime-added columns (payment_method_status, default_payment_method_id).
    // These columns exist in the DB but are not yet in the generated TS types.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const _supabaseAny: any = supabase
    await _supabaseAny.from('facilities').update(updatePayload).eq('id', auth.hospitalId)

    // Audit log
    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: auth.userId,
      action: 'billing.payment_method.attached',
      target_type: 'stripe_payment_method',
      target_id: payment_method_id,
      facility_id: auth.hospitalId,
      metadata: {
        stripe_customer_id: stripeCustomerId,
        payment_method_id,
        setup_intent_id: setup_intent_id ?? null,
        card_brand: (pm as any).card?.brand ?? null,
        card_last4: (pm as any).card?.last4 ?? null,
      },
      ip_address,
    })

    return NextResponse.json({
      success: true,
      payment_method_id,
      message: 'Payment method attached and set as default.',
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[AttachPaymentMethod] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
