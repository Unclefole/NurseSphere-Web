/**
 * E-Signature Webhook Handler
 *
 * Handles inbound webhook events from DocuSign and HelloSign (Dropbox Sign).
 *
 * DocuSign:  POST /api/webhooks/esign
 *            Validates HMAC-256 signature in X-DocuSign-Signature-1 header
 *            Env var: DOCUSIGN_HMAC_KEY
 *
 * HelloSign: POST /api/webhooks/esign
 *            Validates HMAC-256 signature in X-HelloSign-Signature header
 *            Env var: HELLOSIGN_WEBHOOK_SECRET
 *
 * Both providers send to the same endpoint; the handler auto-detects
 * the source based on payload shape and validates accordingly.
 *
 * Events handled:
 *   - envelope completed / signature_request_all_signed → status: 'executed'
 *   - envelope declined / signature_request_declined    → status: 'declined'
 */

import { NextRequest, NextResponse } from 'next/server'
import * as crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

// ─── Supabase ─────────────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

async function auditLog(
  contractId: string | null,
  action: string,
  provider: string,
  metadata: Record<string, unknown>
): Promise<void> {
  if (!contractId) return
  try {
    const supabase = getServiceClient()
    await supabase.from('contract_audit_log').insert({
      contract_id: contractId,
      action,
      provider,
      metadata,
      created_at: new Date().toISOString(),
    })
  } catch {
    // Non-fatal
  }
}

// ─── HMAC Validation ──────────────────────────────────────────────────────────

function validateDocuSignSignature(
  rawBody: string,
  signatureHeader: string,
  hmacKey: string
): boolean {
  const expected = crypto
    .createHmac('sha256', hmacKey)
    .update(rawBody, 'utf8')
    .digest('base64')
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'base64'),
    Buffer.from(signatureHeader, 'base64')
  )
}

function validateHelloSignSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex')
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(signatureHeader, 'hex')
  )
}

// ─── Contract Updates ─────────────────────────────────────────────────────────

async function handleEnvelopeCompleted(
  envelopeId: string,
  completedAt: string,
  provider: string,
  signerData?: Array<{ email: string; signedAt?: string }>
): Promise<void> {
  const supabase = getServiceClient()

  // Look up contract
  const { data: contract } = await supabase
    .from('contracts')
    .select('id, nurse_signed_at, admin_signed_at')
    .eq('signature_request_id', envelopeId)
    .single()

  if (!contract) {
    console.warn(`[EsignWebhook] No contract found for envelope ${envelopeId}`)
    return
  }

  const row = contract as Record<string, unknown>
  const updates: Record<string, unknown> = {
    status: 'executed',
    updated_at: new Date().toISOString(),
  }

  // Attempt to set per-signer timestamps from event data
  if (signerData) {
    for (const signer of signerData) {
      const email = signer.email?.toLowerCase() ?? ''
      if ((email.includes('nurse') || signer.email) && !row.nurse_signed_at) {
        updates.nurse_signed_at = signer.signedAt ?? completedAt
      }
      if (email.includes('admin') && !row.admin_signed_at) {
        updates.admin_signed_at = signer.signedAt ?? completedAt
      }
    }
  }

  // If we couldn't differentiate, set both to completedAt
  if (!row.nurse_signed_at && !updates.nurse_signed_at) {
    updates.nurse_signed_at = completedAt
  }
  if (!row.admin_signed_at && !updates.admin_signed_at) {
    updates.admin_signed_at = completedAt
  }

  await supabase
    .from('contracts')
    .update(updates)
    .eq('signature_request_id', envelopeId)

  await auditLog(String(row.id), 'envelope_completed', provider, {
    envelopeId,
    completedAt,
  })

  console.log(`[EsignWebhook] Contract ${row.id} marked as executed (envelope ${envelopeId})`)
}

async function handleEnvelopeDeclined(
  envelopeId: string,
  provider: string,
  declinedBy?: string
): Promise<void> {
  const supabase = getServiceClient()

  const { data: contract } = await supabase
    .from('contracts')
    .select('id')
    .eq('signature_request_id', envelopeId)
    .single()

  if (!contract) {
    console.warn(`[EsignWebhook] No contract found for declined envelope ${envelopeId}`)
    return
  }

  const row = contract as Record<string, unknown>

  await supabase
    .from('contracts')
    .update({
      status: 'declined',
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('signature_request_id', envelopeId)

  await auditLog(String(row.id), 'envelope_declined', provider, {
    envelopeId,
    declinedBy,
  })

  console.log(`[EsignWebhook] Contract ${row.id} marked as declined (envelope ${envelopeId})`)
}

// ─── DocuSign Handler ─────────────────────────────────────────────────────────

async function handleDocuSign(
  rawBody: string,
  signatureHeader: string | null
): Promise<NextResponse> {
  // Validate HMAC if key is configured
  const hmacKey = process.env.DOCUSIGN_HMAC_KEY
  if (hmacKey) {
    if (!signatureHeader) {
      console.warn('[EsignWebhook] DocuSign: missing X-DocuSign-Signature-1')
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
    }
    if (!validateDocuSignSignature(rawBody, signatureHeader, hmacKey)) {
      console.warn('[EsignWebhook] DocuSign: HMAC validation failed')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  } else {
    console.warn('[EsignWebhook] DocuSign HMAC key not set — skipping signature validation (unsafe for production)')
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const event = (payload.event as string) ?? ''
  const envelopeId = (
    (payload.data as Record<string, unknown>)?.envelopeId ??
    (payload.envelopeId as string)
  ) as string

  console.log(`[EsignWebhook] DocuSign event: ${event} | envelopeId: ${envelopeId}`)
  await auditLog(null, `docusign_webhook_${event}`, 'docusign', { envelopeId, event })

  if (event === 'envelope-completed') {
    const data = (payload.data as Record<string, unknown>) ?? {}
    const completedAt = new Date().toISOString()
    const signers = ((data.recipients as Record<string, unknown>)?.signers as Array<{
      email: string
      signedDateTime?: string
    }>) ?? []

    await handleEnvelopeCompleted(
      envelopeId,
      completedAt,
      'docusign',
      signers.map((s) => ({ email: s.email, signedAt: s.signedDateTime }))
    )
  } else if (event === 'envelope-declined') {
    const data = (payload.data as Record<string, unknown>) ?? {}
    const recipients = (data.recipients as Record<string, unknown>) ?? {}
    const signers = (recipients.signers as Array<{ email: string; status: string }>) ?? []
    const declined = signers.find((s) => s.status === 'declined')
    await handleEnvelopeDeclined(envelopeId, 'docusign', declined?.email)
  }

  return NextResponse.json({ received: true })
}

// ─── HelloSign Handler ────────────────────────────────────────────────────────

async function handleHelloSign(
  rawBody: string,
  signatureHeader: string | null
): Promise<NextResponse> {
  const secret = process.env.HELLOSIGN_WEBHOOK_SECRET
  if (secret) {
    if (!signatureHeader) {
      console.warn('[EsignWebhook] HelloSign: missing X-HelloSign-Signature')
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
    }
    if (!validateHelloSignSignature(rawBody, signatureHeader, secret)) {
      console.warn('[EsignWebhook] HelloSign: HMAC validation failed')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  } else {
    console.warn('[EsignWebhook] HelloSign webhook secret not set — skipping validation (unsafe for production)')
  }

  // HelloSign wraps payload in form field 'json'
  let json: Record<string, unknown>
  try {
    // Depending on content-type, payload might be raw JSON or form-encoded
    if (rawBody.startsWith('{')) {
      json = JSON.parse(rawBody) as Record<string, unknown>
    } else {
      const params = new URLSearchParams(rawBody)
      const jsonStr = params.get('json') ?? '{}'
      json = JSON.parse(jsonStr) as Record<string, unknown>
    }
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const event = json.event as Record<string, unknown> | undefined
  const eventType = (event?.event_type ?? json.event_type) as string
  const signatureRequest = (json.signature_request ?? json) as Record<string, unknown>
  const envelopeId = signatureRequest.signature_request_id as string

  console.log(`[EsignWebhook] HelloSign event: ${eventType} | envelopeId: ${envelopeId}`)
  await auditLog(null, `hellosign_webhook_${eventType}`, 'hellosign', {
    envelopeId,
    eventType,
  })

  if (
    eventType === 'signature_request_all_signed' ||
    eventType === 'signature_request_signed'
  ) {
    const completedAt = new Date().toISOString()
    const signatures = (signatureRequest.signatures as Array<{
      signer_email_address: string
      signed_at?: number
    }>) ?? []

    await handleEnvelopeCompleted(
      envelopeId,
      completedAt,
      'hellosign',
      signatures.map((s) => ({
        email: s.signer_email_address,
        signedAt: s.signed_at ? new Date(s.signed_at * 1000).toISOString() : undefined,
      }))
    )
  } else if (eventType === 'signature_request_declined') {
    await handleEnvelopeDeclined(envelopeId, 'hellosign')
  }

  // HelloSign expects "Hello API Event Received" response
  return new NextResponse('Hello API Event Received', { status: 200 })
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text()

  const docuSignSig = request.headers.get('x-docusign-signature-1')
  const helloSignSig = request.headers.get('x-hellosign-signature')
  const contentType = request.headers.get('content-type') ?? ''

  console.log(`[EsignWebhook] POST received | content-type: ${contentType}`)

  // Detect provider by headers or payload shape
  if (docuSignSig !== null || rawBody.includes('"envelopeId"')) {
    return handleDocuSign(rawBody, docuSignSig)
  }

  if (helloSignSig !== null || rawBody.includes('signature_request')) {
    return handleHelloSign(rawBody, helloSignSig)
  }

  // Unknown provider
  console.warn('[EsignWebhook] Could not identify provider from request')
  return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
}

// Health check
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ status: 'ok', endpoint: 'esign-webhook' })
}
