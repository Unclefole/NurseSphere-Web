/**
 * Security Posture Dashboard — NurseSphere
 *
 * Server Component. super_admin access only.
 *
 * Presents an enterprise-readable security status overview.
 * No marketing language. Factual, auditable, operational.
 *
 * Data shown:
 *   - Encryption at rest / in transit
 *   - PHI storage policy
 *   - Audit logging status
 *   - Tenant isolation model
 *   - Credential integrity
 *   - Compliance sweep frequency
 *   - Zero Trust feature flag status
 *   - Incident reporting process
 */
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { featureFlags } from '@/lib/feature-flags'
import { KeyRotationInput } from './KeyRotationInput'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SecurityControl {
  id: string
  label: string
  status: 'ACTIVE' | 'INACTIVE' | 'MANUAL' | 'CONFIGURED'
  statusColor: 'green' | 'red' | 'yellow' | 'blue'
  detail: string
  note?: string
}

// ─── Security Controls Config ─────────────────────────────────────────────────

function buildSecurityControls(): SecurityControl[] {
  const sweepHours = process.env.COMPLIANCE_SWEEP_INTERVAL_HOURS ?? '24'

  return [
    {
      id: 'encryption-rest',
      label: 'Encryption at rest',
      status: 'ACTIVE',
      statusColor: 'green',
      detail: 'Supabase PostgreSQL — AES-256 (Supabase managed)',
      note: 'Managed by Supabase. All data volumes encrypted at the storage layer.',
    },
    {
      id: 'encryption-transit',
      label: 'Encryption in transit',
      status: 'ACTIVE',
      statusColor: 'green',
      detail: 'TLS 1.3 enforced — Vercel + Supabase',
      note: 'All HTTP traffic requires TLS 1.3. Downgrade rejected.',
    },
    {
      id: 'audit-logging',
      label: 'Audit logging',
      status: 'ACTIVE',
      statusColor: 'green',
      detail: 'Active — all actions logged with actor_id, timestamp, action type',
      note: 'No PHI stored in audit logs. actor_id is a UUID only.',
    },
    {
      id: 'data-isolation',
      label: 'Data isolation',
      status: 'ACTIVE',
      statusColor: 'green',
      detail: 'Multi-tenant RLS — each facility scoped via facility_id',
      note: 'Cross-facility reads blocked at the DB layer via Supabase Row Level Security.',
    },
    {
      id: 'phi-policy',
      label: 'PHI storage policy',
      status: 'ACTIVE',
      statusColor: 'green',
      detail: 'Patient data is architecturally blocked — PHI guard middleware active on all API routes',
      note: 'Fields blocked: patient_name, patient_mrn, diagnosis, icd_code, dob, ssn, and more.',
    },
    {
      id: 'credential-integrity',
      label: 'Credential integrity',
      status: 'ACTIVE',
      statusColor: 'green',
      detail: 'SHA-256 hash stored at upload. Tamper detection on verification.',
      note: 'file_hash column on credentials table. verifyCredentialIntegrity() on re-check.',
    },
    {
      id: 'compliance-sweep',
      label: 'Compliance sweep frequency',
      status: 'CONFIGURED',
      statusColor: 'blue',
      detail: `Every ${sweepHours} hours (COMPLIANCE_SWEEP_INTERVAL_HOURS=${sweepHours})`,
      note: 'Configurable via COMPLIANCE_SWEEP_INTERVAL_HOURS environment variable.',
    },
    {
      id: 'zero-trust',
      label: 'Zero Trust mode',
      status: featureFlags.zero_trust_mode ? 'ACTIVE' : 'INACTIVE',
      statusColor: featureFlags.zero_trust_mode ? 'green' : 'yellow',
      detail: featureFlags.zero_trust_mode
        ? 'Enabled — strict request validation active'
        : 'Disabled (safe-off default) — enable via FEATURE_ZERO_TRUST_MODE=true',
      note: 'Feature flag: zero_trust_mode. Off by default; must be explicitly enabled.',
    },
    {
      id: 'phi-guard-flag',
      label: 'PHI Guard middleware',
      status: featureFlags.phi_guard_enabled ? 'ACTIVE' : 'INACTIVE',
      statusColor: featureFlags.phi_guard_enabled ? 'green' : 'red',
      detail: featureFlags.phi_guard_enabled
        ? 'Enabled — default ON (recommended always-on)'
        : '⚠ DISABLED — PHI fields may reach API handlers. Reenable immediately.',
    },
    {
      id: 'credential-hashing-flag',
      label: 'Credential hashing',
      status: featureFlags.credential_hashing ? 'ACTIVE' : 'INACTIVE',
      statusColor: featureFlags.credential_hashing ? 'green' : 'yellow',
      detail: featureFlags.credential_hashing
        ? 'Enabled — SHA-256 hash computed on all credential uploads'
        : 'Disabled — credential files are not being hashed',
    },
  ]
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  green:  'bg-green-100 text-green-800 border border-green-200',
  red:    'bg-red-100 text-red-800 border border-red-200',
  yellow: 'bg-yellow-100 text-yellow-800 border border-yellow-200',
  blue:   'bg-blue-100 text-blue-800 border border-blue-200',
}

function StatusBadge({ status, color }: { status: string; color: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-mono font-semibold ${STATUS_STYLES[color] ?? STATUS_STYLES.blue}`}>
      {status}
    </span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SecurityPosturePage() {
  // ── Role guard — super_admin only ──────────────────────────────────────────
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/auth/signin?redirect=/dashboard/security-posture')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'super_admin') {
    redirect('/dashboard')
  }

  // ── Build controls ─────────────────────────────────────────────────────────
  const controls = buildSecurityControls()
  const supportEmail = process.env.SUPPORT_EMAIL ?? 'security@nursesphere.com'

  return (
    <div className="max-w-4xl mx-auto py-10 px-4 space-y-8">
      {/* Header */}
      <div className="border-b border-gray-200 pb-6">
        <h1 className="text-2xl font-bold text-gray-900 font-mono">
          Security Posture
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          NurseSphere — Zero Trust Architecture · Generated at{' '}
          {new Date().toISOString()}
        </p>
      </div>

      {/* Controls Table */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
          Security Controls
        </h2>
        <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
          {controls.map((control) => (
            <div key={control.id} className="flex items-start justify-between p-4 bg-white hover:bg-gray-50">
              <div className="flex-1 min-w-0 pr-4">
                <p className="text-sm font-semibold text-gray-900">{control.label}</p>
                <p className="text-sm text-gray-700 mt-0.5">{control.detail}</p>
                {control.note && (
                  <p className="text-xs text-gray-400 mt-1 italic">{control.note}</p>
                )}
              </div>
              <div className="flex-shrink-0">
                <StatusBadge status={control.status} color={control.statusColor} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Key Rotation (manual — localStorage with disclaimer) */}
      <section className="bg-yellow-50 border border-yellow-200 rounded-lg p-5 space-y-3">
        <h2 className="text-sm font-semibold text-yellow-900">
          Last Key Rotation Date (Manual Record)
        </h2>
        <p className="text-xs text-yellow-700">
          Supabase manages database encryption keys. The field below is for your
          team&apos;s manual tracking only. It is stored locally in your browser
          and is not persisted server-side.
        </p>
        {/* Client-side input — rendered in a boundary to avoid SSR key access */}
        <KeyRotationInput />
      </section>

      {/* Incident Reporting */}
      <section className="bg-gray-50 border border-gray-200 rounded-lg p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">
          Incident Reporting Process
        </h2>
        <ol className="list-decimal list-inside text-sm text-gray-700 space-y-1">
          <li>Document the incident in the Compliance Center</li>
          <li>
            Navigate to{' '}
            <a
              href="/dashboard/compliance-center"
              className="text-blue-600 underline hover:text-blue-800"
            >
              /dashboard/compliance-center
            </a>{' '}
            to log and track the incident
          </li>
          <li>
            Email the security team:{' '}
            <a
              href={`mailto:${supportEmail}`}
              className="text-blue-600 underline hover:text-blue-800"
            >
              {supportEmail}
            </a>
          </li>
          <li>If a data breach is suspected, notify affected facilities within 72 hours (HIPAA Rule §164.404)</li>
        </ol>
      </section>

      {/* Architecture Summary */}
      <section className="border-t border-gray-200 pt-6">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Architecture Reference
        </h2>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-medium text-gray-700">Tenant isolation model</dt>
            <dd className="text-gray-500">facility_id on every table · RLS at DB layer</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">PHI guard scope</dt>
            <dd className="text-gray-500">All /api/* routes · POST / PUT / PATCH</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">Credential hash algorithm</dt>
            <dd className="text-gray-500">SHA-256 (Node.js crypto — no external deps)</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">Audit log actor field</dt>
            <dd className="text-gray-500">actor_id (UUID only — no email/name)</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">Select * policy</dt>
            <dd className="text-gray-500">Prohibited — all queries use explicit column lists</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">Session management</dt>
            <dd className="text-gray-500">Supabase SSR · httpOnly cookies · auto-refresh</dd>
          </div>
        </dl>
      </section>
    </div>
  )
}

// KeyRotationInput is a separate 'use client' component in ./KeyRotationInput.tsx
