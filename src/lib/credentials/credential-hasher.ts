/**
 * Credential Hasher — NurseSphere
 *
 * SHA-256 file integrity hashing for credential documents.
 * Enables tamper detection: hash computed at upload, re-verified on-demand.
 *
 * No external dependencies — uses Node.js built-in `crypto` module.
 * No PHI stored. All operations are keyed by credential UUID.
 */

import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { writeAuditLog } from '@/lib/audit'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IntegrityResult {
  matches: boolean
  storedHash: string | null
  computedHash: string
  credential_id: string
}

export interface HashResult {
  hash: string
  credentialId: string
}

// ---------------------------------------------------------------------------
// Supabase service client (server-side only)
// ---------------------------------------------------------------------------

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('[CredentialHasher] Supabase configuration missing.')
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ---------------------------------------------------------------------------
// Core hashing
// ---------------------------------------------------------------------------

/**
 * Computes a SHA-256 hex hash of the provided file buffer.
 * Pure function — no side effects, no I/O.
 */
export function computeCredentialHash(fileBuffer: Buffer): string {
  return crypto.createHash('sha256').update(fileBuffer).digest('hex')
}

// ---------------------------------------------------------------------------
// DB operations
// ---------------------------------------------------------------------------

/**
 * Hashes a credential file and persists the result to the DB.
 *
 * Steps:
 *  1. Compute SHA-256 hash
 *  2. Update credentials record (file_hash, hashed_at, hash_algorithm)
 *  3. Write audit log entry
 *
 * @param credentialId - UUID of the credential record
 * @param fileBuffer   - Raw file bytes
 * @param actorId      - UUID of the user triggering the hash (for audit log)
 */
export async function hashCredentialFile(
  credentialId: string,
  fileBuffer: Buffer,
  actorId: string
): Promise<HashResult> {
  const hash = computeCredentialHash(fileBuffer)
  const algorithm = 'SHA-256'
  const supabase = getServiceClient()

  const { error } = await supabase
    .from('credentials')
    .update({
      file_hash: hash,
      hash_algorithm: algorithm,
      hashed_at: new Date().toISOString(),
    })
    .eq('id', credentialId)

  if (error) {
    throw new Error(`[CredentialHasher] Failed to persist file hash: ${error.message}`)
  }

  await writeAuditLog({
    actor_id: actorId,
    action: 'credential.hashed',
    target_id: credentialId,
    target_type: 'credential',
    metadata: {
      credential_id: credentialId,
      hash_algorithm: algorithm,
    },
  })

  return { hash, credentialId }
}

/**
 * Re-computes the hash of the provided file buffer and compares it against
 * the stored hash in the DB.
 *
 * Returns an IntegrityResult indicating whether the file is intact.
 * If there is a mismatch, an audit log entry is created.
 *
 * @param credentialId - UUID of the credential record
 * @param fileBuffer   - Current file bytes to verify against stored hash
 */
export async function verifyCredentialIntegrity(
  credentialId: string,
  fileBuffer: Buffer
): Promise<IntegrityResult> {
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('credentials')
    .select('id, file_hash, nurse_id')
    .eq('id', credentialId)
    .single()

  if (error || !data) {
    throw new Error(`[CredentialHasher] Credential not found: ${credentialId}`)
  }

  const computedHash = computeCredentialHash(fileBuffer)
  const storedHash: string | null = (data as Record<string, unknown>).file_hash as string | null
  const matches = storedHash !== null && storedHash === computedHash

  if (!matches) {
    const actorId = (data as Record<string, unknown>).nurse_id as string | null
    await writeAuditLog({
      actor_id: actorId ?? null,
      action: 'credential.integrity_failure',
      target_id: credentialId,
      target_type: 'credential',
      metadata: {
        credential_id: credentialId,
        stored_hash_present: storedHash !== null,
        // Never log the actual hash values — they could reveal file structure
        match: false,
      },
    })
  }

  return {
    matches,
    storedHash,
    computedHash,
    credential_id: credentialId,
  }
}

/**
 * Records external verification metadata for a credential.
 * Used after NURSYS / OIG / manual verification completes.
 *
 * @param credentialId - UUID of the credential
 * @param source       - Verification source ('nursys' | 'oig' | 'manual' | 'self_reported')
 * @param reference    - External ID or URL from the verification provider
 * @param verifiedBy   - UUID of the admin/user who triggered verification
 */
export async function recordVerificationMetadata(
  credentialId: string,
  source: 'nursys' | 'oig' | 'manual' | 'self_reported',
  reference: string | null,
  verifiedBy: string
): Promise<void> {
  const supabase = getServiceClient()

  const { error } = await supabase
    .from('credentials')
    .update({
      verified_at: new Date().toISOString(),
      verified_by: verifiedBy,
      verification_source: source,
      verification_reference: reference,
    })
    .eq('id', credentialId)

  if (error) {
    throw new Error(`[CredentialHasher] Failed to record verification metadata: ${error.message}`)
  }

  await writeAuditLog({
    actor_id: verifiedBy,
    action: 'credential.verified',
    target_id: credentialId,
    target_type: 'credential',
    metadata: {
      credential_id: credentialId,
      verification_source: source,
      // reference intentionally omitted from audit log (may contain PII-adjacent IDs)
    },
  })
}
