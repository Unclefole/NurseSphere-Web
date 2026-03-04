/**
 * CredentialIntelligence Agent
 *
 * When a credential document is uploaded, this agent:
 *   1. Reads the credential record
 *   2. Populates extracted_json (structured fields: issuer, dates, license number)
 *   3. Updates credential status based on expires_at
 *
 * Current implementation: manual entry + structured placeholder for extracted_json.
 * Future: plug in OCR (Tesseract / Google Vision) or AI doc parsing via the
 *         ExtractionProvider interface defined below.
 *
 * PHI rules:
 *   - No nurse names, emails, or clinical details in logs
 *   - extracted_json is structural data only (dates, issuer name, license number)
 *   - Never log token, key, or secret values
 *
 * Server-side only.
 */

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import type {
  AgentInterface,
  AgentInput,
  AgentOutput,
  CredentialIntelligenceResult,
  ExtractedCredentialData,
} from './core/types'

// ── Supabase admin client ──────────────────────────────────────────────────────

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role env vars')
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ── Extraction provider interface (pluggable) ──────────────────────────────────

/**
 * ExtractionProvider interface.
 * Implement this to plug in OCR or AI-based extraction.
 * The placeholder implementation uses data already present on the credential record.
 */
interface ExtractionProvider {
  extract(credentialId: string, fileUrl: string | null): Promise<Partial<ExtractedCredentialData>>
}

/**
 * PlaceholderExtractionProvider
 * Returns structured nulls with confidence=0 until real parsing is wired in.
 * Extraction method flagged as 'placeholder' so the UI can prompt for manual entry.
 */
class PlaceholderExtractionProvider implements ExtractionProvider {
  async extract(
    _credentialId: string,
    _fileUrl: string | null,
  ): Promise<Partial<ExtractedCredentialData>> {
    return {
      issuer: null,
      issued_at: null,
      expires_at: null,
      license_number: null,
      confidence: {
        issuer: 0,
        issued_at: 0,
        expires_at: 0,
        license_number: 0,
      },
      extraction_method: 'placeholder',
    }
  }
}

// ── Status resolution ──────────────────────────────────────────────────────────

function resolveStatus(expiresAt: string | null): string {
  if (!expiresAt) return 'active'

  const now = new Date()
  const exp = new Date(expiresAt)
  const daysUntil = Math.floor((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

  if (daysUntil < 0)    return 'expired'
  if (daysUntil <= 7)   return 'expiring_critical'
  if (daysUntil <= 30)  return 'expiring_soon'
  return 'active'
}

// ── Main agent class ───────────────────────────────────────────────────────────

export class CredentialIntelligence implements AgentInterface {
  readonly name = 'CredentialIntelligence' as const

  private provider: ExtractionProvider

  constructor(provider?: ExtractionProvider) {
    this.provider = provider ?? new PlaceholderExtractionProvider()
  }

  /**
   * Plug in a real extraction provider (OCR/AI) when ready:
   *   const agent = new CredentialIntelligence(new MyOCRProvider())
   */
  setProvider(provider: ExtractionProvider): void {
    this.provider = provider
  }

  async run(input: AgentInput): Promise<AgentOutput> {
    const runId = input.runId ?? randomUUID()
    const startedAt = new Date().toISOString()

    try {
      const result = await this._process(input)

      return {
        agentName: this.name,
        runId,
        success: true,
        startedAt,
        completedAt: new Date().toISOString(),
        result,
      }
    } catch (err) {
      return {
        agentName: this.name,
        runId,
        success: false,
        startedAt,
        completedAt: new Date().toISOString(),
        result: null,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  private async _process(input: AgentInput): Promise<CredentialIntelligenceResult> {
    const { credentialId } = input
    if (!credentialId) throw new Error('CredentialIntelligence: credentialId is required')

    const supabase = getAdminClient()

    // ── 1. Load credential record ──────────────────────────────────────────────
    const { data: credential, error } = await supabase
      .from('credentials')
      .select('id, file_url, expiration_date, status, extracted_json, issuer, license_number, issued_at')
      .eq('id', credentialId)
      .maybeSingle()

    if (error) throw new Error(`Failed to load credential: ${error.message}`)
    if (!credential) throw new Error(`Credential not found: ${credentialId}`)

    // ── 2. Build extracted_json ────────────────────────────────────────────────
    // If the credential already has structured data (from manual entry),
    // prefer it over extraction. Otherwise, run the provider.

    let extractedJson: ExtractedCredentialData

    const existingExtracted = credential.extracted_json as Partial<ExtractedCredentialData> | null

    if (
      existingExtracted?.extraction_method &&
      existingExtracted.extraction_method !== 'placeholder'
    ) {
      // Already extracted with a real method — don't overwrite
      extractedJson = {
        issuer: existingExtracted.issuer ?? credential.issuer ?? null,
        issued_at: existingExtracted.issued_at ?? credential.issued_at ?? null,
        expires_at: existingExtracted.expires_at ?? credential.expiration_date ?? null,
        license_number: existingExtracted.license_number ?? credential.license_number ?? null,
        confidence: existingExtracted.confidence ?? { issuer: 0, issued_at: 0, expires_at: 0, license_number: 0 },
        extraction_method: existingExtracted.extraction_method,
        extracted_at: existingExtracted.extracted_at ?? new Date().toISOString(),
      }
    } else {
      // Seed with any values already on the record (manual entry fields)
      const manualSeed: Partial<ExtractedCredentialData> = {
        issuer: (credential.issuer as string | null) ?? null,
        issued_at: (credential.issued_at as string | null) ?? null,
        expires_at: (credential.expiration_date as string | null) ?? null,
        license_number: (credential.license_number as string | null) ?? null,
      }

      // Run extraction provider (placeholder or real)
      const extracted = await this.provider.extract(credentialId, credential.file_url as string | null)

      extractedJson = {
        issuer: extracted.issuer ?? manualSeed.issuer ?? null,
        issued_at: extracted.issued_at ?? manualSeed.issued_at ?? null,
        expires_at: extracted.expires_at ?? manualSeed.expires_at ?? null,
        license_number: extracted.license_number ?? manualSeed.license_number ?? null,
        confidence: extracted.confidence ?? { issuer: 0, issued_at: 0, expires_at: 0, license_number: 0 },
        extraction_method: extracted.extraction_method ?? 'placeholder',
        extracted_at: new Date().toISOString(),
      }
    }

    // ── 3. Resolve status ──────────────────────────────────────────────────────
    const newStatus = resolveStatus(extractedJson.expires_at)
    const statusChanged = newStatus !== credential.status

    // ── 4. Write back to credentials ──────────────────────────────────────────
    const { error: updateError } = await supabase
      .from('credentials')
      .update({
        extracted_json: extractedJson,
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', credentialId)

    if (updateError) {
      throw new Error(`Failed to update credential: ${updateError.message}`)
    }

    return {
      credentialId,
      extractedJson,
      statusUpdated: statusChanged,
      newStatus,
    }
  }
}
