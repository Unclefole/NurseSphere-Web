/**
 * GET  /api/billing/invoices  — list invoices for the authenticated hospital
 * POST /api/billing/invoices  — manually generate a new invoice
 *
 * Phantom guard: if the invoices table doesn't exist in Supabase yet,
 * returns an empty array instead of throwing.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') // optional filter
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)
    const offset = parseInt(searchParams.get('offset') ?? '0', 10)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // eslint-disable-next-line prefer-const
    let query: any = (supabase as any)
      .from('invoices')
      .select('*', { count: 'exact' })
      .eq('hospital_id', auth.hospitalId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status) {
      query = query.eq('status', status)
    }

    const { data, count, error } = await query

    // Phantom guard — table may not be provisioned
    if (error) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        console.warn('[Invoices] invoices table not yet provisioned — returning empty list')
        return NextResponse.json({ invoices: [], total: 0 })
      }
      throw error
    }

    return NextResponse.json({
      invoices: data ?? [],
      total: count ?? 0,
      limit,
      offset,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Invoices GET] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

interface GenerateInvoiceBody {
  /** Optional: specific shift IDs to include */
  shift_ids?: string[]
  /** Optional: manual line item description */
  description?: string
  /** Amount in dollars */
  amount?: number
  due_date?: string
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: GenerateInvoiceBody = {}
    try {
      body = await request.json()
    } catch {
      // empty body is acceptable
    }

    const invoiceNumber = `INV-${Date.now()}-${auth.hospitalId.slice(0, 6).toUpperCase()}`
    const dueDate = body.due_date ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

    const newInvoice = {
      facility_id: auth.hospitalId,
      invoice_number: invoiceNumber,
      status: 'pending',
      total: body.amount ?? 0,
      description: body.description ?? 'Manual invoice',
      shift_ids: body.shift_ids ?? [],
      due_date: dueDate,
      created_by: auth.userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await (supabase as any)
      .from('invoices')
      .insert(newInvoice)
      .select()
      .single()

    if (error) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        return NextResponse.json(
          { error: 'Invoice table not yet provisioned. Please run database migrations.' },
          { status: 503 }
        )
      }
      throw error
    }

    // Audit log
    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: auth.userId,
      action: 'billing.invoice.created',
      target_type: 'invoice',
      target_id: data?.id ?? invoiceNumber,
      facility_id: auth.hospitalId,
      metadata: { invoice_number: invoiceNumber, amount: body.amount },
      ip_address,
    })

    return NextResponse.json({ invoice: data }, { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Invoices POST] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
