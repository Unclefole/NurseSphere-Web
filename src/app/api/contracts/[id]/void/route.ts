/**
 * POST /api/contracts/[id]/void
 *
 * Admin only. Voids a contract with a reason.
 * Body: { reason: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'
import { voidSignatureRequest } from '@/lib/contracts/signature-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

interface VoidBody {
  reason: string
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { id: contractId } = await context.params

  try {
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: VoidBody
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    if (!body.reason?.trim()) {
      return NextResponse.json({ error: 'reason is required' }, { status: 400 })
    }

    // Fetch contract
    const { data: contractRaw, error: contractErr } = await supabase
      .from('contracts')
      .select('id, facility_id, status, signature_request_id')
      .eq('id', contractId)
      .eq('facility_id', auth.hospitalId)
      .single()

    if (contractErr || !contractRaw) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
    }

    const contract = contractRaw as Record<string, unknown>

    if (contract.status === 'voided') {
      return NextResponse.json({ error: 'Contract is already voided' }, { status: 400 })
    }
    if (contract.status === 'executed') {
      return NextResponse.json({ error: 'Cannot void an executed contract' }, { status: 400 })
    }

    // If there's a signature request, void it
    if (contract.signature_request_id) {
      await voidSignatureRequest(contract.signature_request_id as string, body.reason)
    } else {
      // Directly mark as voided
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateErr } = await (supabase as any)
        .from('contracts')
        .update({
          status: 'voided',
          voided_at: new Date().toISOString(),
          voided_reason: body.reason,
          updated_at: new Date().toISOString(),
        })
        .eq('id', contractId)

      if (updateErr) {
        throw new Error(`Failed to void contract: ${updateErr.message}`)
      }
    }

    // Audit
    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: auth.userId,
      facility_id: auth.hospitalId,
      action: 'contract.voided',
      target_id: contractId,
      target_type: 'contract',
      metadata: { reason: body.reason },
      ip_address,
    })

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[VoidContract] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
