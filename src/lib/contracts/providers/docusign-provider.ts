/**
 * DocuSign Provider
 *
 * Implements SignatureProvider using DocuSign eSignature REST API v2.1.
 * Authentication: JWT Grant with RSA private key (service integration — no OAuth redirect).
 *
 * Required env vars:
 *   DOCUSIGN_INTEGRATION_KEY  — Application / Integration Key (client ID)
 *   DOCUSIGN_USER_ID          — Impersonated user GUID
 *   DOCUSIGN_ACCOUNT_ID       — DocuSign account GUID
 *   DOCUSIGN_BASE_URL         — https://demo.docusign.net/restapi (sandbox) or
 *                               https://na1.docusign.net/restapi (production)
 *   DOCUSIGN_AUTH_URL         — https://account-d.docusign.com (sandbox) or
 *                               https://account.docusign.com (production)
 *   DOCUSIGN_PRIVATE_KEY      — RSA private key PEM (newlines as \n or actual newlines)
 */

import * as crypto from 'crypto'
import {
  SignatureProvider,
  CreateEnvelopeParams,
  EnvelopeResult,
  EnvelopeStatus,
} from './signature-provider.interface'

// ─── JWT Token Cache ───────────────────────────────────────────────────────────

interface TokenCache {
  accessToken: string
  expiresAt: number // Unix timestamp (ms)
}

let _tokenCache: TokenCache | null = null
const TOKEN_BUFFER_MS = 60_000 // refresh 1 minute before expiry

// ─── Helper: Build JWT ────────────────────────────────────────────────────────

function buildJwt(
  integrationKey: string,
  userId: string,
  authUrl: string,
  privateKeyPem: string
): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      iss: integrationKey,
      sub: userId,
      aud: new URL(authUrl).hostname,
      iat: now,
      exp: now + 3600, // 1 hour
      scope: 'signature impersonation',
    })
  ).toString('base64url')

  const signingInput = `${header}.${payload}`
  // Normalise private key: allow \n literals in env var
  const pem = privateKeyPem.replace(/\\n/g, '\n')
  const sign = crypto.createSign('RSA-SHA256')
  sign.update(signingInput)
  sign.end()
  const signature = sign.sign(pem, 'base64url')

  return `${signingInput}.${signature}`
}

// ─── DocuSign Provider ────────────────────────────────────────────────────────

export class DocuSignProvider implements SignatureProvider {
  readonly name = 'docusign'

  private readonly integrationKey: string
  private readonly userId: string
  private readonly accountId: string
  private readonly baseUrl: string
  private readonly authUrl: string
  private readonly privateKey: string

  constructor() {
    const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY
    if (!integrationKey) {
      throw new Error(
        '[DocuSignProvider] DOCUSIGN_INTEGRATION_KEY is not set. ' +
          'Configure DocuSign credentials or remove DOCUSIGN_INTEGRATION_KEY to fall back to HelloSign/Stub.'
      )
    }
    this.integrationKey = integrationKey
    this.userId = this.requireEnv('DOCUSIGN_USER_ID')
    this.accountId = this.requireEnv('DOCUSIGN_ACCOUNT_ID')
    this.baseUrl = (process.env.DOCUSIGN_BASE_URL ?? 'https://demo.docusign.net/restapi').replace(
      /\/$/,
      ''
    )
    this.authUrl = process.env.DOCUSIGN_AUTH_URL ?? 'https://account-d.docusign.com'
    this.privateKey = this.requireEnv('DOCUSIGN_PRIVATE_KEY')
  }

  private requireEnv(key: string): string {
    const val = process.env[key]
    if (!val) {
      throw new Error(`[DocuSignProvider] Environment variable ${key} is not set.`)
    }
    return val
  }

  // ── Auth ────────────────────────────────────────────────────────────────────

  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (_tokenCache && _tokenCache.expiresAt - TOKEN_BUFFER_MS > Date.now()) {
      return _tokenCache.accessToken
    }

    const jwt = buildJwt(this.integrationKey, this.userId, this.authUrl, this.privateKey)

    const response = await fetch(`${this.authUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }).toString(),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`[DocuSignProvider] JWT token exchange failed (${response.status}): ${body}`)
    }

    const data = (await response.json()) as { access_token: string; expires_in: number }
    _tokenCache = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    }
    return _tokenCache.accessToken
  }

  private async apiRequest<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const token = await this.getAccessToken()
    const url = `${this.baseUrl}/v2.1/accounts/${this.accountId}${path}`

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`[DocuSignProvider] ${method} ${path} failed (${response.status}): ${text}`)
    }

    // 204 No Content
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  // ── Interface Implementation ────────────────────────────────────────────────

  async createEnvelope(params: CreateEnvelopeParams): Promise<EnvelopeResult> {
    const signers = params.signers.map((s, idx) => ({
      email: s.email,
      name: s.name,
      recipientId: String(idx + 1),
      routingOrder: String(s.order),
      roleName: s.role,
      clientUserId: s.role, // Required for embedded signing
    }))

    const body = {
      emailSubject: params.subject,
      emailBlurb: params.message,
      documents: [
        {
          documentBase64: params.documentBase64,
          name: params.documentName,
          fileExtension: 'pdf',
          documentId: '1',
        },
      ],
      recipients: {
        signers: signers.map((s) => ({
          ...s,
          tabs: {
            signHereTabs: [
              {
                documentId: '1',
                pageNumber: '1',
                xPosition: '100',
                yPosition: '700',
              },
            ],
          },
        })),
      },
      status: 'sent',
    }

    const result = await this.apiRequest<{ envelopeId: string; status: string }>(
      'POST',
      '/envelopes',
      body
    )

    return {
      envelopeId: result.envelopeId,
      status: result.status as EnvelopeResult['status'],
    }
  }

  async getEnvelopeStatus(envelopeId: string): Promise<EnvelopeStatus> {
    const result = await this.apiRequest<{
      currentRoutingOrder: string
      signers?: Array<{
        email: string
        status: string
        signedDateTime?: string
      }>
    }>('GET', `/envelopes/${envelopeId}/recipients`)

    const envelope = await this.apiRequest<{
      status: string
      completedDateTime?: string
    }>('GET', `/envelopes/${envelopeId}`)

    return {
      status: envelope.status,
      completedAt: envelope.completedDateTime,
      signers: (result.signers ?? []).map((s) => ({
        email: s.email,
        status: s.status,
        signedAt: s.signedDateTime,
      })),
    }
  }

  async getSigningUrl(
    envelopeId: string,
    recipientEmail: string,
    recipientName: string,
    returnUrl: string
  ): Promise<string> {
    const body = {
      authenticationMethod: 'none',
      email: recipientEmail,
      userName: recipientName,
      returnUrl,
      clientUserId: recipientEmail, // Must match clientUserId set during createEnvelope
    }

    const result = await this.apiRequest<{ url: string }>(
      'POST',
      `/envelopes/${envelopeId}/views/recipient`,
      body
    )

    return result.url
  }

  async voidEnvelope(envelopeId: string, reason: string): Promise<void> {
    await this.apiRequest<void>('PUT', `/envelopes/${envelopeId}`, {
      status: 'voided',
      voidedReason: reason,
    })
  }

  async downloadSignedDocument(envelopeId: string): Promise<Buffer> {
    const token = await this.getAccessToken()
    const url = `${this.baseUrl}/v2.1/accounts/${this.accountId}/envelopes/${envelopeId}/documents/combined`

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/pdf',
      },
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(
        `[DocuSignProvider] downloadSignedDocument failed (${response.status}): ${text}`
      )
    }

    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }
}
