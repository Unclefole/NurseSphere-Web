/**
 * HelloSign / Dropbox Sign Provider
 *
 * Implements SignatureProvider using the Dropbox Sign REST API v3 (formerly HelloSign).
 * Uses HTTP Basic Auth: API key as username, empty password.
 *
 * Required env vars:
 *   HELLOSIGN_API_KEY    — API key from Dropbox Sign developer dashboard
 *   HELLOSIGN_CLIENT_ID  — Client ID required for embedded signing URLs
 *
 * Docs: https://developers.hellosign.com/api/reference/
 */

import {
  SignatureProvider,
  CreateEnvelopeParams,
  EnvelopeResult,
  EnvelopeStatus,
} from './signature-provider.interface'

const BASE_URL = 'https://api.hellosign.com/v3'

// ─── Response Shape Helpers ────────────────────────────────────────────────────

interface HSSignatureRequest {
  signature_request_id: string
  title: string
  is_complete: boolean
  is_declined: boolean
  has_error: boolean
  signing_url: string
  signing_redirect_url: string | null
  details_url: string
  requester_email_address: string
  requested_at: number
  completed_at: number | null
  signatures: Array<{
    signature_id: string
    signer_email_address: string
    signer_name: string
    order: number | null
    status_code: string
    signed_at: number | null
    last_reminded_at: number | null
    has_pin: boolean
    has_sms_auth: boolean
    has_sms_delivery: boolean
    error?: string
  }>
}

// ─── HelloSign Provider ───────────────────────────────────────────────────────

export class HelloSignProvider implements SignatureProvider {
  readonly name = 'hellosign'

  private readonly apiKey: string
  private readonly clientId: string

  constructor() {
    const apiKey = process.env.HELLOSIGN_API_KEY
    if (!apiKey) {
      throw new Error(
        '[HelloSignProvider] HELLOSIGN_API_KEY is not set. ' +
          'Configure Dropbox Sign credentials or remove both provider keys to use the Stub.'
      )
    }
    this.apiKey = apiKey
    this.clientId = process.env.HELLOSIGN_CLIENT_ID ?? ''
  }

  // ── Auth helpers ────────────────────────────────────────────────────────────

  private authHeader(): string {
    const credentials = Buffer.from(`${this.apiKey}:`).toString('base64')
    return `Basic ${credentials}`
  }

  private async apiRequest<T>(
    method: string,
    path: string,
    bodyInit?: BodyInit,
    contentType?: string
  ): Promise<T> {
    const url = `${BASE_URL}${path}`
    const headers: Record<string, string> = {
      Authorization: this.authHeader(),
      Accept: 'application/json',
    }
    if (contentType) {
      headers['Content-Type'] = contentType
    }

    const response = await fetch(url, {
      method,
      headers,
      body: bodyInit,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`[HelloSignProvider] ${method} ${path} failed (${response.status}): ${text}`)
    }

    if (response.status === 200 && response.headers.get('content-type')?.includes('application/json')) {
      return response.json() as Promise<T>
    }

    // Some endpoints return 204 or binary
    return undefined as T
  }

  // ── Interface Implementation ────────────────────────────────────────────────

  async createEnvelope(params: CreateEnvelopeParams): Promise<EnvelopeResult> {
    // Dropbox Sign uses multipart/form-data for sending signature requests
    const formData = new FormData()
    formData.append('title', params.documentName)
    formData.append('subject', params.subject)
    formData.append('message', params.message)
    formData.append('is_test_mode', process.env.NODE_ENV === 'production' ? '0' : '1')

    // If we have a client ID, enable embedded signing
    if (this.clientId) {
      formData.append('client_id', this.clientId)
    }

    // Attach document as base64 → Blob
    const docBytes = Buffer.from(params.documentBase64, 'base64')
    formData.append(
      'files[0]',
      new Blob([docBytes], { type: 'application/pdf' }),
      params.documentName.endsWith('.pdf') ? params.documentName : `${params.documentName}.pdf`
    )

    // Add signers
    params.signers.forEach((signer, idx) => {
      formData.append(`signers[${idx}][email_address]`, signer.email)
      formData.append(`signers[${idx}][name]`, signer.name)
      formData.append(`signers[${idx}][order]`, String(signer.order))
    })

    const result = await this.apiRequest<{ signature_request: HSSignatureRequest }>(
      'POST',
      '/signature_request/send',
      formData
      // No content-type — let fetch set multipart boundary
    )

    const req = result.signature_request
    const status = this.mapStatus(req)

    // Build signing URL map per role
    const signingUrls: Record<string, string> = {}
    params.signers.forEach((signer, idx) => {
      const sig = req.signatures[idx]
      if (sig?.signature_id && this.clientId) {
        signingUrls[signer.role] = `__pending_${sig.signature_id}` // Requires getSigningUrl() call
      }
    })

    return {
      envelopeId: req.signature_request_id,
      status,
      signingUrls: Object.keys(signingUrls).length > 0 ? signingUrls : undefined,
    }
  }

  async getEnvelopeStatus(envelopeId: string): Promise<EnvelopeStatus> {
    const result = await this.apiRequest<{ signature_request: HSSignatureRequest }>(
      'GET',
      `/signature_request/${envelopeId}`
    )

    const req = result.signature_request
    return {
      status: this.mapStatus(req),
      completedAt: req.completed_at ? new Date(req.completed_at * 1000).toISOString() : undefined,
      signers: req.signatures.map((s) => ({
        email: s.signer_email_address,
        status: s.status_code,
        signedAt: s.signed_at ? new Date(s.signed_at * 1000).toISOString() : undefined,
      })),
    }
  }

  async getSigningUrl(
    envelopeId: string,
    recipientEmail: string,
    _recipientName: string,
    _returnUrl: string
  ): Promise<string> {
    // First look up the signature_id for this recipient
    const statusResult = await this.apiRequest<{ signature_request: HSSignatureRequest }>(
      'GET',
      `/signature_request/${envelopeId}`
    )

    const sig = statusResult.signature_request.signatures.find(
      (s) => s.signer_email_address.toLowerCase() === recipientEmail.toLowerCase()
    )

    if (!sig) {
      throw new Error(
        `[HelloSignProvider] No signer found for ${recipientEmail} in envelope ${envelopeId}`
      )
    }

    const result = await this.apiRequest<{ embedded: { sign_url: string } }>(
      'POST',
      `/embedded/sign_url/${sig.signature_id}`
    )

    return result.embedded.sign_url
  }

  async voidEnvelope(envelopeId: string, _reason: string): Promise<void> {
    // Dropbox Sign cancel endpoint returns 200 with no JSON body
    await fetch(`${BASE_URL}/signature_request/cancel/${envelopeId}`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader(),
      },
    })
  }

  async downloadSignedDocument(envelopeId: string): Promise<Buffer> {
    const url = `${BASE_URL}/signature_request/files/${envelopeId}?file_type=pdf`
    const response = await fetch(url, {
      headers: {
        Authorization: this.authHeader(),
        Accept: 'application/pdf',
      },
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(
        `[HelloSignProvider] downloadSignedDocument failed (${response.status}): ${text}`
      )
    }

    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  // ── Status Mapping ──────────────────────────────────────────────────────────

  private mapStatus(req: HSSignatureRequest): EnvelopeResult['status'] {
    if (req.is_complete) return 'completed'
    if (req.is_declined) return 'declined'
    // All signers pending or partially signed
    const allSigned = req.signatures.every((s) => s.status_code === 'signed')
    if (allSigned) return 'completed'
    return 'sent'
  }
}
