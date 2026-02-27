/**
 * GET /api/risk-reports/certificate/[id]
 *
 * Returns the HTML export of a risk certificate for download.
 * Role-guarded: hospital_admin + super_admin only.
 * Audit logged.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, getAuthenticatedHospital } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'
import { exportCertificatePDF } from '@/lib/acuity/risk-certificate'
import { featureFlags } from '@/lib/feature-flags'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    if (!featureFlags.litigation_defense_export) {
      return NextResponse.json({ error: 'Feature not available' }, { status: 403 })
    }

    const { id: certificateId } = await params
    const supabase = await createSupabaseServerClient()
    const auth = await getAuthenticatedHospital(supabase)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify the certificate belongs to this facility
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: certMeta, error: metaError } = await (supabase as any)
      .from('shift_risk_certificates')
      .select('id, facility_id')
      .eq('id', certificateId)
      .single()

    if (metaError || !certMeta) {
      return NextResponse.json({ error: 'Certificate not found' }, { status: 404 })
    }

    if (certMeta.facility_id !== auth.hospitalId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Generate HTML export
    const { html } = await exportCertificatePDF(certificateId)

    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: auth.userId,
      action: 'litigation_export.certificate_downloaded',
      target_type: 'shift_risk_certificate',
      target_id: certificateId,
      facility_id: auth.hospitalId,
      metadata: { certificate_id: certificateId },
      ip_address,
    })

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="risk-certificate-${certificateId}.html"`,
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[RiskReports] Certificate download error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
