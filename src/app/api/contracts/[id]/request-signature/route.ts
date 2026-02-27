/**
 * POST /api/contracts/[id]/request-signature
 *
 * Admin only. Creates a stub signature request for the contract.
 * Returns signing URLs for both nurse and admin.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'
import { createSignatureRequest } from '@/lib/contracts/signature-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { id: contractId } = await context.params

  try {
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch contract and verify ownership
    const { data: contractRaw, error: contractErr } = await supabase
      .from('contracts')
      .select('id, facility_id, nurse_id, status, pdf_url')
      .eq('id', contractId)
      .eq('facility_id', auth.hospitalId)
      .single()

    if (contractErr || !contractRaw) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
    }

    const contract = contractRaw as Record<string, unknown>

    // Validate state — must be draft or pending_signature
    const status = contract.status as string
    if (status === 'executed' || status === 'voided') {
      return NextResponse.json(
        { error: `Cannot request signatures on a ${status} contract` },
        { status: 400 }
      )
    }

    const nurseId = contract.nurse_id as string

    // Create the signature request (stub)
    const signatureResult = await createSignatureRequest(contractId, nurseId, auth.userId)

    // ServiceResult<SignatureRequest> — check for errors
    if (signatureResult.error || !signatureResult.data) {
      console.error('[RequestSignature] createSignatureRequest failed:', signatureResult.error)
      return NextResponse.json(
        { error: signatureResult.error ?? 'Failed to create signature request' },
        { status: 500 }
      )
    }

    const signatureRequest = signatureResult.data

    // Audit
    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: auth.userId,
      facility_id: auth.hospitalId,
      action: 'contract.signature.requested',
      target_id: contractId,
      target_type: 'contract',
      metadata: {
        request_id: signatureRequest.requestId,
        provider: signatureRequest.provider,
        nurse_id: nurseId,
        expires_at: signatureRequest.expires_at,
      },
      ip_address,
    })

    return NextResponse.json({
      request_id: signatureRequest.requestId,
      nurse_signing_url: signatureRequest.nurse_signing_url,
      admin_signing_url: signatureRequest.admin_signing_url,
      provider: signatureRequest.provider,
      expires_at: signatureRequest.expires_at,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[RequestSignature] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
