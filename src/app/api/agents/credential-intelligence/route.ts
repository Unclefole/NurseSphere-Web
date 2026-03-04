/**
 * POST /api/agents/credential-intelligence
 *
 * Runs the CredentialIntelligence agent for a specific credential.
 * Call this after a credential document is uploaded to trigger extraction + status update.
 *
 * Auth:
 *   - Bearer CRON_SECRET  → automated/batch run
 *   - Authenticated session (nurse owns credential, or admin)
 *
 * Body (JSON):
 *   { credentialId: string }
 *
 * Returns:
 *   { success: true, result: CredentialIntelligenceResult }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabase-server'
import { AgentRunner } from '@/agents/core/AgentRunner'
import { CredentialIntelligence } from '@/agents/CredentialIntelligence'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // ── Auth: CRON_SECRET or authenticated session ─────────────────────────────
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  let authorized = false
  let sessionUserId: string | null = null

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    authorized = true
  }

  if (!authorized) {
    const supabase = await createSupabaseServerClient()
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    sessionUserId = session.user.id
    authorized = true
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: { credentialId?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.credentialId) {
    return NextResponse.json({ error: 'credentialId is required' }, { status: 400 })
  }

  // ── Ownership check (non-cron sessions) ────────────────────────────────────
  if (sessionUserId) {
    const adminClient = createSupabaseAdminClient()
    const { data: profile } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', sessionUserId)
      .maybeSingle()

    // Nurses can only process their own credentials
    if (profile?.role === 'nurse') {
      const { data: cred } = await adminClient
        .from('credentials')
        .select('nurse_id')
        .eq('id', body.credentialId)
        .maybeSingle()

      if (!cred || cred.nurse_id !== sessionUserId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }
  }

  // ── Run agent ──────────────────────────────────────────────────────────────
  const runner = new AgentRunner()
  runner.register(new CredentialIntelligence())

  const output = await runner.run({
    agentName: 'CredentialIntelligence',
    mode: 'on_demand',
    credentialId: body.credentialId,
  })

  if (!output.success) {
    return NextResponse.json(
      { error: 'Agent run failed', detail: output.error },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true, result: output.result }, { status: 200 })
}
