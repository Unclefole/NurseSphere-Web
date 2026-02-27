/**
 * Signature Provider Interface
 *
 * Defines the contract that all e-signature provider implementations must fulfill.
 * Swap providers (DocuSign ↔ HelloSign ↔ Stub) without touching calling code.
 */

export interface SignatureProvider {
  /** Provider name for logging and audit trails */
  name: string

  /**
   * Create an envelope (signature request) and send to signers.
   * @returns EnvelopeResult with envelopeId and optional embedded signing URLs
   */
  createEnvelope(params: CreateEnvelopeParams): Promise<EnvelopeResult>

  /**
   * Retrieve the current status of an envelope and its signers.
   */
  getEnvelopeStatus(envelopeId: string): Promise<EnvelopeStatus>

  /**
   * Generate an embedded signing URL for a specific recipient.
   * URL is valid for a short window (~5 minutes for DocuSign).
   */
  getSigningUrl(
    envelopeId: string,
    recipientEmail: string,
    recipientName: string,
    returnUrl: string
  ): Promise<string>

  /**
   * Void (cancel) an in-flight envelope.
   */
  voidEnvelope(envelopeId: string, reason: string): Promise<void>

  /**
   * Download the completed signed document as a Buffer (PDF bytes).
   */
  downloadSignedDocument(envelopeId: string): Promise<Buffer>
}

// ─── Parameter / Result Types ──────────────────────────────────────────────────

export interface CreateEnvelopeParams {
  /** PDF or HTML document content encoded as base64 */
  documentBase64: string
  documentName: string
  signers: SignerSpec[]
  subject: string
  message: string
}

export interface SignerSpec {
  email: string
  name: string
  role: 'nurse' | 'admin'
  /** Signing order (1 = first) */
  order: number
}

export interface EnvelopeResult {
  envelopeId: string
  status: 'created' | 'sent' | 'delivered' | 'completed' | 'declined' | 'voided'
  /** Map of role → embedded signing URL (populated when embedded signing is used) */
  signingUrls?: Record<string, string>
}

export interface EnvelopeStatus {
  status: string
  completedAt?: string
  signers: SignerStatus[]
}

export interface SignerStatus {
  email: string
  status: string
  signedAt?: string
}
