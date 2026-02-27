/**
 * Stub Signature Provider
 *
 * Used when neither DocuSign nor HelloSign credentials are configured.
 * Mimics the real provider interface without making external API calls.
 * Suitable for local development and testing.
 */

import {
  SignatureProvider,
  CreateEnvelopeParams,
  EnvelopeResult,
  EnvelopeStatus,
} from './signature-provider.interface'

export class StubSignatureProvider implements SignatureProvider {
  readonly name = 'stub'

  async createEnvelope(params: CreateEnvelopeParams): Promise<EnvelopeResult> {
    const envelopeId = `stub_env_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

    const signingUrls: Record<string, string> = {}
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.NEXTAUTH_URL ??
      'https://nursesphere.app'

    for (const signer of params.signers) {
      signingUrls[signer.role] =
        `${baseUrl}/dashboard/contracts/sign?envelopeId=${envelopeId}&role=${signer.role}&token=stub_${envelopeId}`
    }

    return {
      envelopeId,
      status: 'sent',
      signingUrls,
    }
  }

  async getEnvelopeStatus(envelopeId: string): Promise<EnvelopeStatus> {
    return {
      status: 'sent',
      signers: [
        { email: 'nurse@stub.local', status: 'sent' },
        { email: 'admin@stub.local', status: 'sent' },
      ],
    }
  }

  async getSigningUrl(
    envelopeId: string,
    recipientEmail: string,
    _recipientName: string,
    returnUrl: string
  ): Promise<string> {
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.NEXTAUTH_URL ??
      'https://nursesphere.app'

    return `${baseUrl}/dashboard/contracts/sign?envelopeId=${envelopeId}&email=${encodeURIComponent(recipientEmail)}&returnUrl=${encodeURIComponent(returnUrl)}&token=stub_${envelopeId}`
  }

  async voidEnvelope(_envelopeId: string, _reason: string): Promise<void> {
    // Stub: no-op
  }

  async downloadSignedDocument(_envelopeId: string): Promise<Buffer> {
    // Stub: return minimal PDF-like bytes
    return Buffer.from('%PDF-1.4 stub document', 'utf-8')
  }
}
