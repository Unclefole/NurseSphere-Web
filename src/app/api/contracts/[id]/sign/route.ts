/**
 * POST /api/contracts/[id]/sign
 *
 * Authenticated user. Signs the contract as nurse or admin.
 * Body: { role: 'nurse' | 'admin' }
 *
 * Validates that the authenticated user matches the expected role.
 * If both parties have signed → sets status to 'executed'.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { writeAuditLog, extractRequestMeta } from '@/lib/audit'

interface RouteContext {
  params: Promise<{ id: string }>
}

interface SignBody {
  role: 'nurse' | 'admin'
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { id: contractId } = await context.params

  try {
    const supabase = await createSupabaseServerClient()

    // Authenticate
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse body
    let body: SignBody
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    if (!body.role || !['nurse', 'admin'].includes(body.role)) {
      return NextResponse.json({ error: 'role must be "nurse" or "admin"' }, { status: 400 })
    }

    // Fetch contract
    const { data: contractRaw, error: contractErr } = await supabase
      .from('contracts')
      .select('id, facility_id, nurse_id, status, nurse_signed_at, admin_signed_at')
      .eq('id', contractId)
      .single()

    if (contractErr || !contractRaw) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
    }

    const contract = contractRaw as Record<string, unknown>

    // Check contract is in a signable state
    const status = contract.status as string
    if (status === 'executed') {
      return NextResponse.json({ error: 'Contract is already executed' }, { status: 400 })
    }
    if (status === 'voided') {
      return NextResponse.json({ error: 'Contract has been voided' }, { status: 400 })
    }

    const nurseId = contract.nurse_id as string
    const facilityId = contract.facility_id as string

    // Validate user matches role
    if (body.role === 'nurse') {
      if (user.id !== nurseId) {
        return NextResponse.json({ error: 'You are not the nurse on this contract' }, { status: 403 })
      }
    } else {
      // admin — must be a facility_admin for this facility
      const { data: facilityAdminRaw } = await supabase
        .from('facility_admins')
        .select('facility_id')
        .eq('profile_id', user.id)
        .eq('facility_id', facilityId)
        .single()

      if (!facilityAdminRaw) {
        return NextResponse.json(
          { error: 'You are not an admin for this facility' },
          { status: 403 }
        )
      }
    }

    const now = new Date().toISOString()

    // Build update payload
    const updatePayload: Record<string, unknown> = { updated_at: now }

    if (body.role === 'nurse') {
      if (contract.nurse_signed_at) {
        return NextResponse.json({ error: 'Nurse has already signed' }, { status: 400 })
      }
      updatePayload.nurse_signed_at = now
    } else {
      if (contract.admin_signed_at) {
        return NextResponse.json({ error: 'Admin has already signed' }, { status: 400 })
      }
      updatePayload.admin_signed_at = now
    }

    // Determine if both parties have now signed
    const nurseSignedAt = body.role === 'nurse' ? now : (contract.nurse_signed_at as string | null)
    const adminSignedAt = body.role === 'admin' ? now : (contract.admin_signed_at as string | null)
    const bothSigned = !!nurseSignedAt && !!adminSignedAt

    if (bothSigned) {
      updatePayload.status = 'executed'
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateErr } = await (supabase as any)
      .from('contracts')
      .update(updatePayload)
      .eq('id', contractId)

    if (updateErr) {
      throw new Error(`Failed to update contract: ${updateErr.message}`)
    }

    // Audit
    const { ip_address } = extractRequestMeta(request)
    await writeAuditLog({
      actor_id: user.id,
      facility_id: facilityId,
      action: body.role === 'nurse' ? 'contract.signed.nurse' : 'contract.signed.admin',
      target_id: contractId,
      target_type: 'contract',
      metadata: {
        role: body.role,
        executed: bothSigned,
        signed_at: now,
      },
      ip_address,
    })

    return NextResponse.json({
      success: true,
      signed_at: now,
      role: body.role,
      executed: bothSigned,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Sign] Error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
