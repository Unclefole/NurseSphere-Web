import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { generateContractPDF } from '@/lib/pdf/contract-generator'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createServerSupabaseClient()

    // Auth check
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const contractId = params.id

    // Fetch contract with related data
    const { data: contract, error: contractError } = await supabase
      .from('contracts')
      .select(`
        id,
        title,
        content,
        status,
        terms,
        created_at,
        expires_at,
        nurse_signed_at,
        admin_signed_at,
        pdf_url,
        nurse_id,
        facility_id,
        shift_id
      `)
      .eq('id', contractId)
      .single()

    if (contractError || !contract) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
    }

    // Verify access: must be the nurse or a facility admin for this contract
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role === 'nurse' && contract.nurse_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (profile?.role === 'hospital_admin') {
      const { data: facilityAdmin } = await supabase
        .from('facility_admins')
        .select('facility_id')
        .eq('profile_id', user.id)
        .eq('facility_id', contract.facility_id)
        .single()

      if (!facilityAdmin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // Fetch related nurse profile
    const { data: nurseProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', contract.nurse_id)
      .single()

    // Fetch facility
    const { data: facility } = await supabase
      .from('facilities')
      .select('name, contact_email')
      .eq('id', contract.facility_id)
      .single()

    // Fetch nurse email from auth (server-side only)
    let nurseEmail = ''
    try {
      const { data: nurseAuth } = await supabase.auth.admin.getUserById(contract.nurse_id)
      nurseEmail = nurseAuth?.user?.email || ''
    } catch { /* non-blocking */ }

    // Fetch shift if linked
    let shiftData = null
    if (contract.shift_id) {
      const { data: shift } = await supabase
        .from('shifts')
        .select('title, start_time')
        .eq('id', contract.shift_id)
        .single()
      shiftData = shift
    }

    // Generate PDF
    const pdfBytes = await generateContractPDF({
      id: contract.id,
      title: contract.title,
      content: contract.content,
      status: contract.status,
      terms: contract.terms,
      created_at: contract.created_at,
      expires_at: contract.expires_at,
      nurse: { full_name: nurseProfile?.full_name, email: nurseEmail },
      facility: { name: facility?.name, contact_email: facility?.contact_email },
      nurse_signed_at: contract.nurse_signed_at,
      admin_signed_at: contract.admin_signed_at,
      shift: shiftData,
    })

    // Optionally persist PDF URL to Supabase Storage (if storage bucket exists)
    try {
      const fileName = `contracts/${contract.id}.pdf`
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(fileName, pdfBytes, {
          contentType: 'application/pdf',
          upsert: true,
        })

      if (!uploadError) {
        const { data: signedUrl } = await supabase.storage
          .from('documents')
          .createSignedUrl(fileName, 3600) // 1 hour expiry

        // Update contract with pdf_url
        if (signedUrl) {
          await supabase
            .from('contracts')
            .update({ pdf_url: signedUrl.signedUrl })
            .eq('id', contract.id)
        }
      }
    } catch { /* Storage not configured — still return the PDF */ }

    // Audit log
    try {
      await supabase.from('audit_logs').insert({
        event_type: 'export',
        entity_id: contract.id,
        entity_type: 'contract',
        actor_id: user.id,
        metadata: { action: 'pdf_generated', contract_status: contract.status },
      })
    } catch { /* non-blocking */ }

    const safeTitle = contract.title.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_')

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeTitle}_${contract.id.slice(0, 8)}.pdf"`,
        'Cache-Control': 'private, no-cache',
      },
    })
  } catch (error) {
    console.error('[Contract PDF] Error generating PDF:', error)
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 })
  }
}
