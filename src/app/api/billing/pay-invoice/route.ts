/**
 * POST /api/billing/pay-invoice
 *
 * Creates a Stripe PaymentIntent for an existing invoice.
 * Validates that the invoice belongs to the authenticated hospital.
 * Audit logs the payment attempt.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe/client'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'
import { toCents } from '@/lib/stripe/fee-calculator'
import { parseAndValidate, payInvoiceSchema } from '@/lib/validation/schemas'

interface PayInvoiceBody {
  invoice_id: string
  /** Optional: override payment method ID */
  payment_method_id?: string
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Zod input validation
    const [body, validationError] = await parseAndValidate(payInvoiceSchema, request)
    if (validationError) return validationError as unknown as NextResponse

    const { invoice_id, payment_method_id } = body

    // Fetch invoice and validate ownership
    const { data: invoice, error: invoiceError } = await (supabase as any)
      .from('invoices')
      .select('id, status, total, invoice_number, hospital_id')
      .eq('id', invoice_id)
      .eq('hospital_id', auth.hospitalId) // Ownership check
      .single()

    if (invoiceError || !invoice) {
      return NextResponse.json(
        { error: 'Invoice not found or access denied' },
        { status: 404 }
      )
    }

    if ((invoice as any).status === 'paid') {
      return NextResponse.json(
        { error: 'Invoice is already paid' },
        { status: 409 }
      )
    }

    // Fetch Stripe customer ID
    const { data: facility } = await supabase
      .from('facilities')
      .select('stripe_customer_id, default_payment_method_id')
      .eq('id', auth.hospitalId)
      .single()

    const stripeCustomerId: string = (facility as any)?.stripe_customer_id ?? ''
    if (!stripeCustomerId) {
      return NextResponse.json(
        { error: 'No payment method configured. Please set up billing first.' },
        { status: 422 }
      )
    }

    const pmId =
      payment_method_id ??
      (facility as any)?.default_payment_method_id ??
      undefined

    const stripe = getStripe()
    const amountCents = toCents((invoice as any).total ?? 0)

    if (amountCents <= 0) {
      return NextResponse.json(
        { error: 'Invoice amount must be greater than zero' },
        { status: 422 }
      )
    }

    // Create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      customer: stripeCustomerId,
      payment_method: pmId,
      confirm: !!pmId, // auto-confirm if we have a payment method
      off_session: true, // hospital is not in the checkout flow
      metadata: {
        invoice_id,
        invoice_number: (invoice as any).invoice_number ?? '',
        facility_id: auth.hospitalId,
        platform: 'nursesphere',
      },
      description: `NurseSphere Invoice ${(invoice as any).invoice_number ?? invoice_id}`,
    })

    // Update invoice with payment intent reference
    await (supabase as any)
      .from('invoices')
      .update({
        stripe_payment_intent_id: paymentIntent.id,
        status: paymentIntent.status === 'succeeded' ? 'paid' : 'processing',
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', invoice_id)

    // Audit log
    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: auth.userId,
      action: 'billing.invoice.payment_attempted',
      target_type: 'invoice',
      target_id: invoice_id,
      facility_id: auth.hospitalId,
      metadata: {
        payment_intent_id: paymentIntent.id,
        amount_cents: amountCents,
        payment_intent_status: paymentIntent.status,
        invoice_number: (invoice as any).invoice_number,
      },
      ip_address,
    })

    return NextResponse.json({
      payment_intent_id: paymentIntent.id,
      client_secret: paymentIntent.client_secret,
      status: paymentIntent.status,
      requires_action: paymentIntent.status === 'requires_action',
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[PayInvoice] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
