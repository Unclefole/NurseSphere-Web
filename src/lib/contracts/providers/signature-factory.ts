/**
 * Signature Provider Factory
 *
 * Returns the appropriate SignatureProvider based on available configuration.
 * Priority order:
 *   1. DocuSign   — DOCUSIGN_INTEGRATION_KEY is set
 *   2. HelloSign  — HELLOSIGN_API_KEY is set
 *   3. Stub       — neither key is configured (dev/test mode)
 *
 * Never throws — always returns a usable provider.
 * Logs clearly which provider is active.
 */

import { SignatureProvider } from './signature-provider.interface'
import { DocuSignProvider } from './docusign-provider'
import { HelloSignProvider } from './hellosign-provider'
import { StubSignatureProvider } from './stub-provider'

export function getSignatureProvider(): SignatureProvider {
  if (process.env.DOCUSIGN_INTEGRATION_KEY) {
    try {
      const provider = new DocuSignProvider()
      console.log('[SignatureFactory] Active provider: DocuSign')
      return provider
    } catch (err) {
      console.error(
        '[SignatureFactory] DocuSign provider initialization failed; checking HelloSign fallback.',
        err
      )
    }
  }

  if (process.env.HELLOSIGN_API_KEY) {
    try {
      const provider = new HelloSignProvider()
      console.log('[SignatureFactory] Active provider: HelloSign (Dropbox Sign)')
      return provider
    } catch (err) {
      console.error(
        '[SignatureFactory] HelloSign provider initialization failed; falling back to Stub.',
        err
      )
    }
  }

  console.warn(
    '[SignatureFactory] ⚠️  No e-signature credentials configured. ' +
      'Using STUB provider. Set DOCUSIGN_INTEGRATION_KEY or HELLOSIGN_API_KEY for production.'
  )
  return new StubSignatureProvider()
}

/**
 * Cached singleton — provider is resolved once per process lifecycle.
 * Use getSignatureProvider() for a fresh instance (e.g., in tests).
 */
let _cachedProvider: SignatureProvider | null = null

export function getSignatureProviderSingleton(): SignatureProvider {
  if (!_cachedProvider) {
    _cachedProvider = getSignatureProvider()
  }
  return _cachedProvider
}

/** Reset the cached singleton (useful for tests that manipulate env vars). */
export function resetSignatureProviderCache(): void {
  _cachedProvider = null
}
