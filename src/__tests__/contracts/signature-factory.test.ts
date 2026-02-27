/**
 * Tests: Signature Provider Factory
 *
 * Verifies provider selection logic and interface completeness.
 * All providers must expose the same interface methods.
 */

import {
  getSignatureProvider,
  resetSignatureProviderCache,
} from '../../lib/contracts/providers/signature-factory'
import { DocuSignProvider } from '../../lib/contracts/providers/docusign-provider'
import { HelloSignProvider } from '../../lib/contracts/providers/hellosign-provider'
import { StubSignatureProvider } from '../../lib/contracts/providers/stub-provider'
import type { SignatureProvider } from '../../lib/contracts/providers/signature-provider.interface'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const REQUIRED_METHODS: (keyof SignatureProvider)[] = [
  'createEnvelope',
  'getEnvelopeStatus',
  'getSigningUrl',
  'voidEnvelope',
  'downloadSignedDocument',
]

function assertProviderInterface(provider: SignatureProvider): void {
  for (const method of REQUIRED_METHODS) {
    expect(typeof provider[method]).toBe('function')
  }
  expect(typeof provider.name).toBe('string')
  expect(provider.name.length).toBeGreaterThan(0)
}

// Save original env
const originalEnv = { ...process.env }

beforeEach(() => {
  // Reset env and singleton cache before each test
  process.env = { ...originalEnv }
  delete process.env.DOCUSIGN_INTEGRATION_KEY
  delete process.env.DOCUSIGN_USER_ID
  delete process.env.DOCUSIGN_ACCOUNT_ID
  delete process.env.DOCUSIGN_PRIVATE_KEY
  delete process.env.HELLOSIGN_API_KEY
  delete process.env.HELLOSIGN_CLIENT_ID
  resetSignatureProviderCache()
})

afterEach(() => {
  process.env = { ...originalEnv }
  resetSignatureProviderCache()
})

// ─── Factory Selection Tests ──────────────────────────────────────────────────

describe('getSignatureProvider()', () => {
  test('returns DocuSignProvider when DOCUSIGN_INTEGRATION_KEY is set', () => {
    process.env.DOCUSIGN_INTEGRATION_KEY = 'test-integration-key'
    process.env.DOCUSIGN_USER_ID = 'test-user-id'
    process.env.DOCUSIGN_ACCOUNT_ID = 'test-account-id'
    process.env.DOCUSIGN_PRIVATE_KEY = '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----'

    const provider = getSignatureProvider()
    expect(provider).toBeInstanceOf(DocuSignProvider)
    expect(provider.name).toBe('docusign')
  })

  test('returns HelloSignProvider when only HELLOSIGN_API_KEY is set', () => {
    process.env.HELLOSIGN_API_KEY = 'test-hellosign-api-key'

    const provider = getSignatureProvider()
    expect(provider).toBeInstanceOf(HelloSignProvider)
    expect(provider.name).toBe('hellosign')
  })

  test('returns StubSignatureProvider when neither key is set', () => {
    const provider = getSignatureProvider()
    expect(provider).toBeInstanceOf(StubSignatureProvider)
    expect(provider.name).toBe('stub')
  })

  test('prefers DocuSign over HelloSign when both keys are set', () => {
    process.env.DOCUSIGN_INTEGRATION_KEY = 'docusign-key'
    process.env.DOCUSIGN_USER_ID = 'uid'
    process.env.DOCUSIGN_ACCOUNT_ID = 'acct'
    process.env.DOCUSIGN_PRIVATE_KEY = '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----'
    process.env.HELLOSIGN_API_KEY = 'hellosign-key'

    const provider = getSignatureProvider()
    expect(provider.name).toBe('docusign')
  })

  test('falls back to HelloSign if DocuSign init fails', () => {
    // Set DOCUSIGN_INTEGRATION_KEY but omit required DOCUSIGN_USER_ID
    // DocuSignProvider constructor will throw → factory should catch and try HelloSign
    process.env.DOCUSIGN_INTEGRATION_KEY = 'key'
    // Intentionally omit DOCUSIGN_USER_ID to trigger constructor error
    process.env.HELLOSIGN_API_KEY = 'hellosign-fallback-key'

    const provider = getSignatureProvider()
    expect(provider.name).toBe('hellosign')
  })

  test('falls back to Stub if both providers fail to init', () => {
    // Set both keys but omit required secondary vars to trigger constructor failures
    process.env.DOCUSIGN_INTEGRATION_KEY = 'key'
    // Omit DOCUSIGN_USER_ID — DocuSign constructor throws
    process.env.HELLOSIGN_API_KEY = '' // Empty string → treated as not set
    delete process.env.HELLOSIGN_API_KEY

    const provider = getSignatureProvider()
    expect(provider.name).toBe('stub')
  })
})

// ─── Interface Completeness Tests ─────────────────────────────────────────────

describe('Provider interface completeness', () => {
  test('DocuSignProvider implements SignatureProvider interface', () => {
    process.env.DOCUSIGN_INTEGRATION_KEY = 'key'
    process.env.DOCUSIGN_USER_ID = 'uid'
    process.env.DOCUSIGN_ACCOUNT_ID = 'acct'
    process.env.DOCUSIGN_PRIVATE_KEY = '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----'

    const provider = new DocuSignProvider()
    assertProviderInterface(provider)
  })

  test('HelloSignProvider implements SignatureProvider interface', () => {
    process.env.HELLOSIGN_API_KEY = 'test-key'

    const provider = new HelloSignProvider()
    assertProviderInterface(provider)
  })

  test('StubSignatureProvider implements SignatureProvider interface', () => {
    const provider = new StubSignatureProvider()
    assertProviderInterface(provider)
  })
})

// ─── Stub Provider Behavior Tests ────────────────────────────────────────────

describe('StubSignatureProvider', () => {
  test('createEnvelope returns a valid EnvelopeResult', async () => {
    const provider = new StubSignatureProvider()
    const result = await provider.createEnvelope({
      documentBase64: Buffer.from('<html>test</html>').toString('base64'),
      documentName: 'test-contract.pdf',
      signers: [
        { email: 'nurse@test.com', name: 'Jane Nurse', role: 'nurse', order: 1 },
        { email: 'admin@test.com', name: 'Bob Admin', role: 'admin', order: 2 },
      ],
      subject: 'Sign this contract',
      message: 'Please sign.',
    })

    expect(result.envelopeId).toBeTruthy()
    expect(result.status).toBe('sent')
    expect(result.signingUrls).toBeDefined()
    expect(result.signingUrls?.nurse).toBeTruthy()
    expect(result.signingUrls?.admin).toBeTruthy()
  })

  test('getEnvelopeStatus returns a status object', async () => {
    const provider = new StubSignatureProvider()
    const status = await provider.getEnvelopeStatus('stub_env_test_123')

    expect(status.status).toBeTruthy()
    expect(Array.isArray(status.signers)).toBe(true)
  })

  test('getSigningUrl returns a URL string', async () => {
    const provider = new StubSignatureProvider()
    const url = await provider.getSigningUrl(
      'stub_env_test_123',
      'nurse@test.com',
      'Jane Nurse',
      'https://nursesphere.app/done'
    )

    expect(typeof url).toBe('string')
    expect(url.length).toBeGreaterThan(0)
  })

  test('voidEnvelope resolves without error', async () => {
    const provider = new StubSignatureProvider()
    await expect(
      provider.voidEnvelope('stub_env_test_123', 'Testing void')
    ).resolves.toBeUndefined()
  })

  test('downloadSignedDocument returns a Buffer', async () => {
    const provider = new StubSignatureProvider()
    const buffer = await provider.downloadSignedDocument('stub_env_test_123')
    expect(Buffer.isBuffer(buffer)).toBe(true)
    expect(buffer.length).toBeGreaterThan(0)
  })
})

// ─── DocuSignProvider Constructor Tests ───────────────────────────────────────

describe('DocuSignProvider constructor', () => {
  test('throws descriptive error when DOCUSIGN_INTEGRATION_KEY is missing', () => {
    expect(() => new DocuSignProvider()).toThrow('DOCUSIGN_INTEGRATION_KEY')
  })

  test('throws descriptive error when DOCUSIGN_USER_ID is missing', () => {
    process.env.DOCUSIGN_INTEGRATION_KEY = 'key'
    expect(() => new DocuSignProvider()).toThrow('DOCUSIGN_USER_ID')
  })
})

// ─── HelloSignProvider Constructor Tests ─────────────────────────────────────

describe('HelloSignProvider constructor', () => {
  test('throws descriptive error when HELLOSIGN_API_KEY is missing', () => {
    expect(() => new HelloSignProvider()).toThrow('HELLOSIGN_API_KEY')
  })
})
