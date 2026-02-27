/**
 * POST /api/contracts/[id]/generate-pdf
 *
 * Admin only. Generates an HTML contract document from the contract
 * record + optional template and stores it in Supabase Storage.
 * Updates contract.pdf_url.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'
import { generateContractPdf, type ContractVariables } from '@/lib/contracts/pdf-generator'

interface RouteContext {
  params: Promise<{ id: string }>
}

interface GeneratePdfBody {
  template_id?: string
  variables?: ContractVariables
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { id: contractId } = await context.params

  try {
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify contract belongs to this facility
    const { data: contractRaw, error: contractErr } = await supabase
      .from('contracts')
      .select('id, facility_id, nurse_id, title, content, status')
      .eq('id', contractId)
      .eq('facility_id', auth.hospitalId)
      .single()

    if (contractErr || !contractRaw) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
    }

    const contract = contractRaw as Record<string, unknown>

    // Parse optional body
    let body: GeneratePdfBody = {}
    try {
      body = await request.json()
    } catch {
      // empty body is fine
    }

    // Build variables — merge defaults from contract with caller-supplied overrides
    const variables: ContractVariables = {
      ...((contract.terms as ContractVariables) ?? {}),
      ...(body.variables ?? {}),
    }

    // Generate the document
    const pdfUrl = await generateContractPdf(contractId, body.template_id ?? null, variables)

    // Update the contract record with the pdf_url
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateErr } = await (supabase as any)
      .from('contracts')
      .update({ pdf_url: pdfUrl, updated_at: new Date().toISOString() })
      .eq('id', contractId)

    if (updateErr) {
      console.error('[GeneratePDF] Update failed:', updateErr.message)
      // Still return the URL even if the update failed
    }

    // Audit
    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: auth.userId,
      facility_id: auth.hospitalId,
      action: 'contract.pdf.generated',
      target_id: contractId,
      target_type: 'contract',
      metadata: {
        template_id: body.template_id ?? null,
        pdf_url: pdfUrl,
      },
      ip_address,
    })

    return NextResponse.json({ pdf_url: pdfUrl }, { status: 200 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[GeneratePDF] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
