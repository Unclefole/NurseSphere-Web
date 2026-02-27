/**
 * invoice-trigger.ts
 *
 * Auto-generates an invoice when a shift is marked 'completed'.
 *
 * Flow:
 *  1. Fetch shift (hours derived from start/end, hourly_rate, facility_id, nurse_id)
 *  2. Calculate: subtotal = hours × rate, platform_fee = subtotal × 0.06, total = subtotal
 *  3. Insert invoice record into the invoices table (stub-safe)
 *  4. Create Stripe invoice item + finalize Stripe invoice against facility customer
 *  5. Audit log: action='invoice.auto_created'
 */
import { getStripe } from '@/lib/stripe/client'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { writeAuditLog } from '@/lib/audit'

/**
 * Triggered when a shift is marked as completed.
 * Fire-and-forget safe: errors are caught and logged, never rethrown.
 */
export async function triggerInvoiceOnShiftCompletion(
  shiftId: string,
  facilityId: string,
  actorId?: string
): Promise<void> {
  try {
    const supabase = createSupabaseAdminClient()

    // 1. Fetch shift details
    const { data: shiftRaw, error: shiftError } = await (supabase as any)
      .from('shifts')
      .select('id, title, start_time, end_time, hourly_rate, nurse_id, facility_id, status')
      .eq('id', shiftId)
      .single()

    if (shiftError || !shiftRaw) {
      console.error('[InvoiceTrigger] Shift not found:', shiftId, shiftError)
      return
    }

    const shift = shiftRaw as {
      id: string
      title: string
      start_time: string
      end_time: string
      hourly_rate: number
      nurse_id: string | null
      facility_id: string
      status: string
    }

    // 2. Calculate billing amounts
    const startMs = new Date(shift.start_time).getTime()
    const endMs = new Date(shift.end_time).getTime()
    const hours = Math.max((endMs - startMs) / (1000 * 60 * 60), 0)
    const hourlyRate = Number(shift.hourly_rate) || 0
    const subtotal = parseFloat((hours * hourlyRate).toFixed(2))
    const platformFee = parseFloat((subtotal * 0.06).toFixed(2))
    const total = subtotal // Facility pays subtotal; platform fee is deducted from nurse payout

    const subtotalCents = Math.round(subtotal * 100)
    const platformFeeCents = Math.round(platformFee * 100)

    // 3. Fetch facility's Stripe customer ID
    const { data: facilityRaw } = await (supabase as any)
      .from('facilities')
      .select('stripe_customer_id, name')
      .eq('id', facilityId)
      .single()

    const facility = facilityRaw as {
      stripe_customer_id: string | null
      name: string
    } | null

    // 4. Create invoice record in DB
    const invoiceNumber = `INV-AUTO-${Date.now()}-${shiftId.slice(0, 6).toUpperCase()}`
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

    const invoiceRecord = {
      facility_id: facilityId,
      invoice_number: invoiceNumber,
      status: 'pending',
      total,
      subtotal,
      platform_fee: platformFee,
      description: `Auto-invoice for shift: ${shift.title} (${hours.toFixed(2)} hrs @ $${hourlyRate}/hr)`,
      shift_ids: [shiftId],
      nurse_id: shift.nurse_id,
      hours_worked: parseFloat(hours.toFixed(4)),
      hourly_rate: hourlyRate,
      due_date: dueDate,
      created_by: actorId ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const { data: savedInvoice, error: insertError } = await (supabase as any)
      .from('invoices')
      .insert(invoiceRecord)
      .select('id')
      .single()

    if (insertError) {
      if (insertError.code === '42P01' || insertError.message?.includes('does not exist')) {
        console.warn('[InvoiceTrigger] invoices table not yet provisioned — skipping DB insert')
      } else {
        console.error('[InvoiceTrigger] Failed to insert invoice:', insertError)
      }
    }

    // 5. Create Stripe invoice (if customer exists)
    let stripeInvoiceId: string | null = null
    if (facility?.stripe_customer_id && subtotalCents > 0) {
      try {
        const stripe = getStripe()

        // Create an invoice item on the customer
        await stripe.invoiceItems.create({
          customer: facility.stripe_customer_id,
          amount: subtotalCents,
          currency: 'usd',
          description: `Shift: ${shift.title} — ${hours.toFixed(2)} hrs × $${hourlyRate}/hr`,
          metadata: {
            shift_id: shiftId,
            nurse_id: shift.nurse_id ?? '',
            facility_id: facilityId,
            platform_fee_cents: String(platformFeeCents),
          },
        })

        // Create and finalize the invoice
        const stripeInvoice = await stripe.invoices.create({
          customer: facility.stripe_customer_id,
          auto_advance: true, // automatically finalizes
          collection_method: 'charge_automatically',
          metadata: {
            invoice_number: invoiceNumber,
            shift_id: shiftId,
            facility_id: facilityId,
            nurse_id: shift.nurse_id ?? '',
          },
          description: `NurseSphere — ${facility.name ?? 'Facility'} — ${shift.title}`,
        })

        // Finalize immediately
        const finalized = await stripe.invoices.finalizeInvoice(stripeInvoice.id)
        stripeInvoiceId = finalized.id

        // Update DB invoice with Stripe ID if the record was created
        if (savedInvoice?.id && stripeInvoiceId) {
          await (supabase as any)
            .from('invoices')
            .update({ stripe_invoice_id: stripeInvoiceId, updated_at: new Date().toISOString() })
            .eq('id', savedInvoice.id)
        }
      } catch (stripeErr) {
        console.error('[InvoiceTrigger] Stripe invoice creation failed:', stripeErr)
        // Non-fatal — DB record still exists
      }
    }

    // 6. Audit log
    await writeAuditLog({
      actor_id: actorId ?? null,
      action: 'invoice.auto_created',
      target_type: 'invoice',
      target_id: savedInvoice?.id ?? invoiceNumber,
      facility_id: facilityId,
      metadata: {
        shift_id: shiftId,
        invoice_number: invoiceNumber,
        hours,
        hourly_rate: hourlyRate,
        subtotal,
        platform_fee: platformFee,
        total,
        stripe_invoice_id: stripeInvoiceId,
        nurse_id: shift.nurse_id,
      },
    })

    console.info(`[InvoiceTrigger] Invoice created for shift ${shiftId}: ${invoiceNumber} — $${total}`)
  } catch (err) {
    console.error('[InvoiceTrigger] Unexpected error:', err)
    // Never rethrow — invoice failure should not block shift completion
  }
}
