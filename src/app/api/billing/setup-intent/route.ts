/**
 * POST /api/billing/setup-intent
 *
 * Creates a Stripe SetupIntent for the authenticated hospital.
 * Returns the client_secret for use with Stripe Elements on the frontend.
 * Associates the SetupIntent with the hospital's Stripe customer.
 * Creates the Stripe customer on first call if none exists.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe/client'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const stripe = getStripe()

    // Fetch facility to get or create Stripe customer ID
    const { data: facilityData, error: facilityError } = await (supabase as any)
      .from('facilities')
      .select('id, name, email, stripe_customer_id')
      .eq('id', auth.hospitalId)
      .single()

    const facility = facilityData as { id: string; name: string; email: string | null; stripe_customer_id: string | null } | null

    if (facilityError || !facility) {
      return NextResponse.json(
        { error: 'Facility not found' },
        { status: 404 }
      )
    }

    let stripeCustomerId: string = facility.stripe_customer_id ?? ''

    // Create Stripe customer if not present
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: facility.email ?? auth.email,
        name: facility.name,
        metadata: {
          facility_id: auth.hospitalId,
          platform: 'nursesphere',
        },
      })
      stripeCustomerId = customer.id

      // Persist customer ID in facilities table
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('facilities').update({ stripe_customer_id: stripeCustomerId }).eq('id', auth.hospitalId)
    }

    // Create SetupIntent attached to the customer
    const setupIntent = await stripe.setupIntents.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      metadata: {
        facility_id: auth.hospitalId,
        user_id: auth.userId,
        platform: 'nursesphere',
      },
    })

    // Audit log
    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: auth.userId,
      action: 'billing.setup_intent.created',
      target_type: 'stripe_setup_intent',
      target_id: setupIntent.id,
      facility_id: auth.hospitalId,
      metadata: {
        stripe_customer_id: stripeCustomerId,
        setup_intent_id: setupIntent.id,
      },
      ip_address,
    })

    return NextResponse.json({
      client_secret: setupIntent.client_secret,
      setup_intent_id: setupIntent.id,
      stripe_customer_id: stripeCustomerId,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[SetupIntent] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
