/**
 * Signature Service
 *
 * Thin orchestration layer between NurseSphere business logic and the
 * active e-signature provider (DocuSign / HelloSign / Stub).
 *
 * All methods:
 *   - Delegate to the provider resolved by getSignatureProviderSingleton()
 *   - Write an audit log entry identifying the active provider
 *   - Catch provider errors gracefully and return structured error results
 *     instead of crashing the caller
 *
 * Provider swap: change env vars only — no code changes needed here.
 */

import { createClient } from '@supabase/supabase-js'
import { generateContractPdf } from './pdf-generator'
import { getSignatureProviderSingleton } from './providers/signature-factory'
import type { EnvelopeResult, EnvelopeStatus } from './providers/signature-provider.interface'

// ─── Legacy-compatible public types ───────────────────────────────────────────

export interface SignatureRequest {
  requestId: string
  nurse_signing_url: string
  admin_signing_url: string
  provider: 'stub' | 'docusign' | 'hellosign' | 'signnow'
  expires_at: string
}

export interface SignatureStatus {
  nurse_signed: boolean
  admin_signed: boolean
  completed: boolean
  voided: boolean
  nurse_signed_at: string | null
  admin_signed_at: string | null
  voided_at: string | null
  voided_reason: string | null
}

export interface ServiceResult<T> {
  data?: T
  error?: string
}

// ─── Supabase client ──────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Supabase env vars missing for signature service.')
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function getBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    'https://nursesphere.app'
  )
}

// ─── Audit Logging ─────────────────────────────────────────────────────────────

async function auditLog(
  contractId: string,
  action: string,
  provider: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    const supabase = getServiceClient()
    await supabase.from('contract_audit_log').insert({
      contract_id: contractId,
      action,
      provider,
      metadata,
      created_at: new Date().toISOString(),
    })
  } catch (err) {
    // Audit failures are non-fatal — log to console and continue
    console.warn('[SignatureService] Audit log write failed:', err)
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a signature request for a contract.
 *
 * Generates (or retrieves) the contract PDF, sends it to the active
 * e-signature provider, and updates the contract record with the envelope ID.
 */
export async function createSignatureRequest(
  contractId: string,
  nurseId: string,
  adminId: string,
  options?: {
    nurseEmail: string
    nurseName: string
    adminEmail: string
    adminName: string
    subject?: string
    message?: string
    templateId?: string
    variables?: Record<string, string | number>
  }
): Promise<ServiceResult<SignatureRequest>> {
  const provider = getSignatureProviderSingleton()
  const supabase = getServiceClient()

  try {
    // Fetch contract metadata for PDF generation
    const { data: contract, error: contractError } = await supabase
      .from('contracts')
      .select('id, facility_id, nurse_id, status, title, content, signed_at, created_at, updated_at, template_id, rate, start_date, end_date')
      .eq('id', contractId)
      .single()

    if (contractError || !contract) {
      return { error: `Contract not found: ${contractId}` }
    }

    // Generate PDF document (HTML-based stub or actual PDF)
    let documentBase64: string
    try {
      const pdfUrl = await generateContractPdf(
        contractId,
        options?.templateId ?? (contract as Record<string, unknown>).template_id as string | null ?? null,
        options?.variables ?? {}
      )
      // If it's a data URL, extract the base64
      if (pdfUrl.startsWith('data:')) {
        documentBase64 = pdfUrl.split(',')[1]
      } else {
        // Fetch the document from storage and convert to base64
        const resp = await fetch(pdfUrl)
        const buffer = await resp.arrayBuffer()
        documentBase64 = Buffer.from(buffer).toString('base64')
      }
    } catch (pdfErr) {
      console.error('[SignatureService] PDF generation failed:', pdfErr)
      return { error: 'Failed to generate contract document.' }
    }

    // Build signer list
    const signers = [
      {
        email: options?.nurseEmail ?? `nurse_${nurseId}@nursesphere.app`,
        name: options?.nurseName ?? 'Nurse',
        role: 'nurse' as const,
        order: 1,
      },
      {
        email: options?.adminEmail ?? `admin_${adminId}@nursesphere.app`,
        name: options?.adminName ?? 'Administrator',
        role: 'admin' as const,
        order: 2,
      },
    ]

    console.log(`[SignatureService] Creating envelope via ${provider.name} for contract ${contractId}`)

    let envelopeResult: EnvelopeResult
    try {
      envelopeResult = await provider.createEnvelope({
        documentBase64,
        documentName: `NurseSphere_Contract_${contractId.slice(0, 8).toUpperCase()}.pdf`,
        signers,
        subject: options?.subject ?? 'NurseSphere Employment Contract — Signature Required',
        message:
          options?.message ??
          'Please review and sign your NurseSphere employment contract. Contact us if you have any questions.',
      })
    } catch (providerErr) {
      console.error(`[SignatureService] ${provider.name} createEnvelope failed:`, providerErr)
      await auditLog(contractId, 'create_envelope_failed', provider.name, {
        error: String(providerErr),
      })
      return { error: `E-signature provider error: ${String(providerErr)}` }
    }

    // Build signing URLs (from embedded signing or fallback)
    const baseUrl = getBaseUrl()
    const nurse_signing_url =
      envelopeResult.signingUrls?.['nurse'] ??
      `${baseUrl}/dashboard/contracts/${contractId}/sign?role=nurse&envelopeId=${envelopeResult.envelopeId}`
    const admin_signing_url =
      envelopeResult.signingUrls?.['admin'] ??
      `${baseUrl}/dashboard/contracts/${contractId}/sign?role=admin&envelopeId=${envelopeResult.envelopeId}`

    const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    // Persist envelope ID on contract record
    const { error: updateError } = await supabase
      .from('contracts')
      .update({
        signature_provider: provider.name,
        signature_request_id: envelopeResult.envelopeId,
        status: 'pending_signature',
        nurse_signature_url: nurse_signing_url,
        admin_signature_url: admin_signing_url,
        updated_at: new Date().toISOString(),
      } as Record<string, unknown>)
      .eq('id', contractId)

    if (updateError) {
      console.error('[SignatureService] Failed to update contract record:', updateError)
      return { error: `Database update failed: ${updateError.message}` }
    }

    await auditLog(contractId, 'create_envelope', provider.name, {
      envelopeId: envelopeResult.envelopeId,
      envelopeStatus: envelopeResult.status,
    })

    return {
      data: {
        requestId: envelopeResult.envelopeId,
        nurse_signing_url,
        admin_signing_url,
        provider: provider.name as SignatureRequest['provider'],
        expires_at,
      },
    }
  } catch (err) {
    console.error('[SignatureService] Unexpected error in createSignatureRequest:', err)
    return { error: `Unexpected error: ${String(err)}` }
  }
}

/**
 * Check the current signature status of a contract.
 * Delegates to the active provider, then reconciles with local DB.
 */
export async function checkSignatureStatus(requestId: string): Promise<SignatureStatus> {
  const provider = getSignatureProviderSingleton()
  const supabase = getServiceClient()

  // Always fetch local DB state first (source of truth after webhooks)
  const { data, error } = await supabase
    .from('contracts')
    .select('nurse_signed_at, admin_signed_at, voided_at, voided_reason, status, id')
    .eq('signature_request_id', requestId)
    .single()

  if (error || !data) {
    throw new Error(`Signature request not found: ${requestId}`)
  }

  const row = data as Record<string, unknown>

  // Optionally refresh from provider if not yet completed
  if (!row.nurse_signed_at || !row.admin_signed_at) {
    try {
      const providerStatus: EnvelopeStatus = await provider.getEnvelopeStatus(requestId)
      console.log(
        `[SignatureService] Provider ${provider.name} status for ${requestId}: ${providerStatus.status}`
      )

      // Sync provider-reported sign timestamps to DB
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
      for (const signer of providerStatus.signers) {
        if (signer.email.includes('nurse') && signer.signedAt && !row.nurse_signed_at) {
          updates.nurse_signed_at = signer.signedAt
        }
        if (signer.email.includes('admin') && signer.signedAt && !row.admin_signed_at) {
          updates.admin_signed_at = signer.signedAt
        }
      }
      if (providerStatus.status === 'completed' || providerStatus.status === 'executed') {
        updates.status = 'executed'
      }

      if (Object.keys(updates).length > 1) {
        await supabase
          .from('contracts')
          .update(updates)
          .eq('signature_request_id', requestId)

        await auditLog(String(row.id), 'status_sync', provider.name, {
          providerStatus: providerStatus.status,
        })
      }
    } catch (providerErr) {
      // Non-fatal: use DB state
      console.warn(`[SignatureService] Provider status check failed, using cached DB state:`, providerErr)
    }
  }

  // Re-read after potential sync
  const { data: refreshed } = await supabase
    .from('contracts')
    .select('nurse_signed_at, admin_signed_at, voided_at, voided_reason, status')
    .eq('signature_request_id', requestId)
    .single()

  const final = (refreshed ?? row) as Record<string, unknown>
  const nurse_signed = !!final.nurse_signed_at
  const admin_signed = !!final.admin_signed_at

  return {
    nurse_signed,
    admin_signed,
    completed: nurse_signed && admin_signed,
    voided: !!final.voided_at,
    nurse_signed_at: (final.nurse_signed_at as string) ?? null,
    admin_signed_at: (final.admin_signed_at as string) ?? null,
    voided_at: (final.voided_at as string) ?? null,
    voided_reason: (final.voided_reason as string) ?? null,
  }
}

/**
 * Void a signature request via the active provider and update the DB.
 */
export async function voidSignatureRequest(
  requestId: string,
  reason: string
): Promise<void> {
  const provider = getSignatureProviderSingleton()
  const supabase = getServiceClient()

  try {
    console.log(`[SignatureService] Voiding envelope ${requestId} via ${provider.name}`)
    await provider.voidEnvelope(requestId, reason)
  } catch (err) {
    console.error(`[SignatureService] ${provider.name} voidEnvelope failed:`, err)
    // Fall through and still mark voided in DB
  }

  const { data: contractRow } = await supabase
    .from('contracts')
    .select('id')
    .eq('signature_request_id', requestId)
    .single()

  const { error } = await supabase
    .from('contracts')
    .update({
      status: 'voided',
      voided_at: new Date().toISOString(),
      voided_reason: reason,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('signature_request_id', requestId)

  if (error) {
    throw new Error(`Failed to void signature request in DB: ${error.message}`)
  }

  if (contractRow) {
    await auditLog(String((contractRow as Record<string, unknown>).id), 'void_envelope', provider.name, { reason })
  }
}

/**
 * Get an embedded signing URL for a specific signer.
 * Delegates to active provider.
 */
export async function getEmbeddedSigningUrl(
  envelopeId: string,
  recipientEmail: string,
  recipientName: string,
  returnUrl: string
): Promise<ServiceResult<string>> {
  const provider = getSignatureProviderSingleton()

  try {
    console.log(`[SignatureService] Getting signing URL from ${provider.name} for ${recipientEmail}`)
    const url = await provider.getSigningUrl(envelopeId, recipientEmail, recipientName, returnUrl)
    return { data: url }
  } catch (err) {
    console.error(`[SignatureService] ${provider.name} getSigningUrl failed:`, err)
    return { error: `Failed to get signing URL: ${String(err)}` }
  }
}

/**
 * Download the completed signed document.
 */
export async function downloadSignedDocument(envelopeId: string): Promise<ServiceResult<Buffer>> {
  const provider = getSignatureProviderSingleton()

  try {
    console.log(`[SignatureService] Downloading signed document from ${provider.name}`)
    const buffer = await provider.downloadSignedDocument(envelopeId)
    return { data: buffer }
  } catch (err) {
    console.error(`[SignatureService] ${provider.name} downloadSignedDocument failed:`, err)
    return { error: `Failed to download document: ${String(err)}` }
  }
}
