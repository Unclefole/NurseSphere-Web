/**
 * Renewal Document Submit API
 * POST /api/credentials/renewal/[id]/submit
 * Nurse submits a new credential document URL for their renewal task.
 * Body: { document_url: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { submitRenewalDocument } from '@/lib/credentials/renewal-flow'

export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { document_url?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { document_url } = body

  if (!document_url) {
    return NextResponse.json({ error: 'document_url is required' }, { status: 400 })
  }

  // Validate URL format (basic check)
  try {
    new URL(document_url)
  } catch {
    return NextResponse.json({ error: 'document_url must be a valid URL' }, { status: 400 })
  }

  const task = await submitRenewalDocument(id, user.id, document_url)

  if (!task) {
    return NextResponse.json(
      { error: 'Failed to submit document. Task may not exist or you may not own it.' },
      { status: 404 }
    )
  }

  return NextResponse.json({ task })
}
