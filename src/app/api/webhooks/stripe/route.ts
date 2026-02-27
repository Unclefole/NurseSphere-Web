/**
 * POST /api/webhooks/stripe
 *
 * Stripe webhook receiver.
 * Validates signature using STRIPE_WEBHOOK_SECRET.
 *
 * Handled events:
 *   payment_intent.succeeded
 *   payment_intent.payment_failed
 *   invoice.paid
 *   invoice.payment_failed
 *   customer.subscription.updated
 *
 * IMPORTANT: This route must NOT use the Supabase cookie-based auth
 * (no auth headers from Stripe). Uses admin client directly.
 */
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getStripe } from '@/lib/stripe/client'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { writeAuditLog } from '@/lib/audit'

// Force dynamic rendering — webhook must not be cached
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[StripeWebhook] STRIPE_WEBHOOK_SECRET is not configured')
    return NextResponse.json(
      { error: 'Webhook secret not configured' },
      { status: 500 }
    )
  }

  // Read raw body as buffer for signature verification
  const rawBody = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 }
    )
  }

  const stripe = getStripe()
  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Signature verification failed'
    console.error('[StripeWebhook] Signature error:', message)
    return NextResponse.json({ error: `Webhook Error: ${message}` }, { status: 400 })
  }

  console.log(`[StripeWebhook] Received event: ${event.type} (${event.id})`)

  try {
    await handleWebhookEvent(event)
  } catch (err: unknown) {
    console.error(`[StripeWebhook] Handler failed for ${event.type}:`, err)
    // Return 200 to avoid Stripe retrying — we'll log the error internally
  }

  return NextResponse.json({ received: true })
}

// ─── Event Handlers ───────────────────────────────────────────────────────────

async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  const supabase = createSupabaseAdminClient()

  switch (event.type) {
    // ── PaymentIntent succeeded ──────────────────────────────────────────────
    case 'payment_intent.succeeded': {
      const pi = event.data.object as Stripe.PaymentIntent
      const invoiceId = pi.metadata?.invoice_id
      const hospitalId = pi.metadata?.hospital_id

      if (invoiceId) {
        await (supabase as any)
          .from('invoices')
          .update({
            status: 'paid',
            paid_at: new Date().toISOString(),
            stripe_payment_intent_id: pi.id,
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', invoiceId)
      }

      await writeAuditLog({
        actor_id: null,
        action: 'webhook.payment_intent.succeeded',
        target_type: 'stripe_payment_intent',
        target_id: pi.id,
        facility_id: hospitalId ?? null,
        metadata: {
          invoice_id: invoiceId ?? null,
          amount: pi.amount,
          currency: pi.currency,
        },
      })
      break
    }

    // ── PaymentIntent failed ─────────────────────────────────────────────────
    case 'payment_intent.payment_failed': {
      const pi = event.data.object as Stripe.PaymentIntent
      const invoiceId = pi.metadata?.invoice_id
      const hospitalId = pi.metadata?.hospital_id
      const failureMessage = pi.last_payment_error?.message ?? 'Unknown error'

      if (invoiceId) {
        await (supabase as any)
          .from('invoices')
          .update({
            status: 'failed',
            failure_reason: failureMessage,
            stripe_payment_intent_id: pi.id,
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', invoiceId)
      }

      await writeAuditLog({
        actor_id: null,
        action: 'webhook.payment_intent.failed',
        target_type: 'stripe_payment_intent',
        target_id: pi.id,
        facility_id: hospitalId ?? null,
        metadata: {
          invoice_id: invoiceId ?? null,
          amount: pi.amount,
          failure_reason: failureMessage,
        },
      })
      break
    }

    // ── Stripe Invoice paid ──────────────────────────────────────────────────
    case 'invoice.paid': {
      const inv = event.data.object as Stripe.Invoice
      const customerId = inv.customer as string

      // Look up hospital by Stripe customer ID
      const { data: facility } = await supabase
        .from('facilities')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .single()

      await writeAuditLog({
        actor_id: null,
        action: 'webhook.invoice.paid',
        target_type: 'stripe_invoice',
        target_id: inv.id,
        facility_id: (facility as any)?.id ?? null,
        metadata: {
          stripe_customer_id: customerId,
          amount_paid: inv.amount_paid,
          currency: inv.currency,
          stripe_invoice_id: inv.id,
        },
      })
      break
    }

    // ── Stripe Invoice payment failed ────────────────────────────────────────
    case 'invoice.payment_failed': {
      const inv = event.data.object as Stripe.Invoice
      const customerId = inv.customer as string

      const { data: facility } = await supabase
        .from('facilities')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .single()

      // Mark any matching internal invoice as failed
      if ((facility as any)?.id) {
        await (supabase as any)
          .from('invoices')
          .update({
            status: 'failed',
            failure_reason: 'Stripe invoice payment failed',
            updated_at: new Date().toISOString(),
          } as any)
          .eq('hospital_id', (facility as any).id)
          .eq('stripe_invoice_id', inv.id)
      }

      await writeAuditLog({
        actor_id: null,
        action: 'webhook.invoice.payment_failed',
        target_type: 'stripe_invoice',
        target_id: inv.id,
        facility_id: (facility as any)?.id ?? null,
        metadata: {
          stripe_customer_id: customerId,
          amount_due: inv.amount_due,
          attempt_count: inv.attempt_count,
        },
      })
      break
    }

    // ── Subscription updated ─────────────────────────────────────────────────
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      const customerId = sub.customer as string

      const { data: facility } = await supabase
        .from('facilities')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .single()

      // Update subscription status on facility
      if ((facility as any)?.id) {
        await (supabase as any)
          .from('facilities')
          .update({
            subscription_status: sub.status,
            subscription_id: sub.id,
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', (facility as any).id)
      }

      await writeAuditLog({
        actor_id: null,
        action: 'webhook.subscription.updated',
        target_type: 'stripe_subscription',
        target_id: sub.id,
        facility_id: (facility as any)?.id ?? null,
        metadata: {
          stripe_customer_id: customerId,
          subscription_status: sub.status,
          current_period_end: (sub as unknown as Record<string, unknown>).current_period_end ?? null,
        },
      })
      break
    }

    default:
      console.log(`[StripeWebhook] Unhandled event type: ${event.type}`)
  }
}
