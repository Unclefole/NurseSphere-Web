/**
 * Shift Risk Certificate Generator — NurseSphere TIER 3
 *
 * Generates immutable, SHA-256 signed staffing decision records for
 * litigation defense. No PHI stored — nurse identified by UUID only.
 *
 * Each certificate captures:
 *   - Credential status snapshot (at time of cert)
 *   - Competency snapshot (at time of cert)
 *   - Compliance + competency scores
 *   - Alternative candidates available
 *   - Decision basis (criteria met + overrides)
 *   - SHA-256 hash for tamper detection
 */
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { writeAuditLog } from '@/lib/audit'
import { getNurseCompetencies } from '@/lib/acuity/competency-service'
import type { Competency } from '@/lib/acuity/competency-service'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RiskCertificate {
  id: string
  shift_id: string
  nurse_id: string
  facility_id: string
  credential_status_snapshot: CredentialSnapshot[]
  competency_snapshot: CompetencySnapshot[]
  compliance_score: number
  competency_score: number
  alternative_candidates_available: number
  decision_basis: DecisionBasis
  admin_override: boolean
  override_justification: string | null
  override_actor_id: string | null
  certificate_hash: string | null
  issued_at: string
  created_at: string
}

export interface CredentialSnapshot {
  credential_id: string
  type: string
  title: string
  status: string
  expiry_date: string | null
  // No PHI fields allowed
}

export interface CompetencySnapshot {
  competency_id: string
  unit_type: string
  hours_last_12mo: number
  competency_score: number
  recency_index: number
  verified: boolean
}

export interface DecisionBasis {
  criteria_met: string[]
  overrides: string[]
  compliance_score: number
  competency_score: number
}

// ─── PHI field list — NEVER include these ──────────────────────────────────

const PHI_FIELDS = [
  'patient_name', 'patient_id', 'mrn', 'diagnosis', 'ssn', 'dob',
  'date_of_birth', 'address', 'phone', 'email', 'insurance_id',
]

function sanitizeSnapshot<T extends Record<string, unknown>>(record: T): Omit<T, string> {
  const sanitized = { ...record }
  for (const field of PHI_FIELDS) {
    delete (sanitized as Record<string, unknown>)[field]
  }
  return sanitized
}

// ─── Supabase client ────────────────────────────────────────────────────────

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ─── Hash ────────────────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of certificate content fields for tamper detection.
 * Uses a canonical JSON representation (sorted keys).
 */
export function computeCertificateHash(payload: {
  shift_id: string
  nurse_id: string
  facility_id: string
  credential_status_snapshot: CredentialSnapshot[]
  competency_snapshot: CompetencySnapshot[]
  compliance_score: number
  competency_score: number
  decision_basis: DecisionBasis
  issued_at: string
}): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort())
  return createHash('sha256').update(canonical).digest('hex')
}

// ─── Certificate Generation ──────────────────────────────────────────────────

/**
 * Generate a risk certificate for a shift acceptance decision.
 * Immutable once created — no update/delete.
 */
export async function generateRiskCertificate(
  shiftId: string,
  nurseId: string,
  adminId?: string,
  overrideJustification?: string
): Promise<RiskCertificate> {
  const supabase = getServiceClient()

  // 1. Fetch shift
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: shiftRaw, error: shiftError } = await (supabase as any)
    .from('shifts')
    .select('id, facility_id, title, acuity_level, minimum_competency_score')
    .eq('id', shiftId)
    .single()

  if (shiftError || !shiftRaw) {
    throw new Error(`Shift not found: ${shiftId}`)
  }

  const shift = shiftRaw as {
    id: string
    facility_id: string
    title: string
    acuity_level: string | null
    minimum_competency_score: number
  }

  // 2. Fetch credentials (no PHI)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: credentialsRaw } = await (supabase as any)
    .from('credentials')
    .select('id, type, title, status, expiry_date')
    .eq('profile_id', nurseId)

  const credentialSnapshot: CredentialSnapshot[] = (credentialsRaw ?? []).map(
    (c: Record<string, unknown>) => {
      const sanitized = sanitizeSnapshot(c)
      return {
        credential_id: sanitized.id as string,
        type: sanitized.type as string,
        title: sanitized.title as string,
        status: sanitized.status as string,
        expiry_date: (sanitized.expiry_date as string) ?? null,
      }
    }
  )

  // 3. Fetch competencies
  const competencies: Competency[] = await getNurseCompetencies(nurseId)
  const competencySnapshot: CompetencySnapshot[] = competencies.map((c) => ({
    competency_id: c.id,
    unit_type: c.unit_type,
    hours_last_12mo: c.hours_last_12mo,
    competency_score: c.competency_score,
    recency_index: c.recency_index,
    verified: c.verified,
  }))

  // 4. Compute compliance score (% active/valid credentials)
  const totalCreds = credentialSnapshot.length
  const activeCreds = credentialSnapshot.filter((c) =>
    ['active', 'verified', 'valid'].includes(c.status?.toLowerCase?.() ?? '')
  ).length
  const complianceScore = totalCreds > 0
    ? Math.round((activeCreds / totalCreds) * 100 * 100) / 100
    : 100

  // 5. Compute average competency score
  const avgCompetencyScore = competencySnapshot.length > 0
    ? Math.round(
        (competencySnapshot.reduce((sum, c) => sum + c.competency_score, 0) /
          competencySnapshot.length) * 100
      ) / 100
    : 0

  // 6. Count alternative candidates (other nurses in same facility with similar competencies)
  const unitTypes = competencySnapshot.map((c) => c.unit_type)
  let alternativeCandidates = 0

  if (unitTypes.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: altNurses } = await (supabase as any)
      .from('competencies')
      .select('nurse_id')
      .in('unit_type', unitTypes)
      .gte('competency_score', shift.minimum_competency_score ?? 60)
      .neq('nurse_id', nurseId)

    // Count distinct nurses in same facility
    const distinctNurseIds: string[] = [...new Set((altNurses ?? []).map((r: { nurse_id: string }) => r.nurse_id))]

    if (distinctNurseIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: facilityNurses } = await (supabase as any)
        .from('profiles')
        .select('id')
        .eq('facility_id', shift.facility_id)
        .eq('role', 'nurse')
        .eq('status', 'active')
        .in('id', distinctNurseIds)

      alternativeCandidates = facilityNurses?.length ?? 0
    }
  }

  // 7. Build decision basis
  const criteriamet: string[] = []

  if (complianceScore >= 80) criteriamet.push(`Compliance score: ${complianceScore}% (≥80% threshold)`)
  if (avgCompetencyScore >= (shift.minimum_competency_score ?? 60)) {
    criteriamet.push(`Competency score: ${avgCompetencyScore} (≥${shift.minimum_competency_score ?? 60} threshold)`)
  }
  if (credentialSnapshot.every((c) => c.status !== 'expired')) {
    criteriamet.push('No expired credentials at time of assignment')
  }

  const overrides: string[] = []
  if (overrideJustification) {
    overrides.push(`Admin override: ${overrideJustification}`)
  }

  const decisionBasis: DecisionBasis = {
    criteria_met: criteriamet,
    overrides,
    compliance_score: complianceScore,
    competency_score: avgCompetencyScore,
  }

  // 8. Compute certificate hash
  const issuedAt = new Date().toISOString()
  const hashPayload = {
    shift_id: shiftId,
    nurse_id: nurseId,
    facility_id: shift.facility_id,
    credential_status_snapshot: credentialSnapshot,
    competency_snapshot: competencySnapshot,
    compliance_score: complianceScore,
    competency_score: avgCompetencyScore,
    decision_basis: decisionBasis,
    issued_at: issuedAt,
  }
  const certificateHash = computeCertificateHash(hashPayload)

  // 9. Insert certificate (immutable — no update/delete)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: certRecord, error: insertError } = await (supabase as any)
    .from('shift_risk_certificates')
    .insert({
      shift_id: shiftId,
      nurse_id: nurseId,
      facility_id: shift.facility_id,
      credential_status_snapshot: credentialSnapshot,
      competency_snapshot: competencySnapshot,
      compliance_score: complianceScore,
      competency_score: avgCompetencyScore,
      alternative_candidates_available: alternativeCandidates,
      decision_basis: decisionBasis,
      admin_override: !!overrideJustification,
      override_justification: overrideJustification ?? null,
      override_actor_id: adminId ?? null,
      certificate_hash: certificateHash,
      issued_at: issuedAt,
    })
    .select()
    .single()

  if (insertError) {
    console.error('[RiskCertificate] Insert error:', insertError.message)
    throw new Error(`Failed to generate risk certificate: ${insertError.message}`)
  }

  // 10. Audit log
  await writeAuditLog({
    actor_id: adminId ?? nurseId,
    action: 'risk_certificate.issued',
    target_type: 'shift_risk_certificate',
    target_id: certRecord.id,
    facility_id: shift.facility_id,
    metadata: {
      certificate_id: certRecord.id,
      shift_id: shiftId,
      nurse_id: nurseId,
      compliance_score: complianceScore,
      competency_score: avgCompetencyScore,
      admin_override: !!overrideJustification,
    },
  })

  return certRecord as RiskCertificate
}

// ─── Certificate Integrity Verification ─────────────────────────────────────

/**
 * Recompute the certificate hash and verify it matches the stored hash.
 * Returns { valid: false } if the record has been tampered with.
 */
export async function verifyCertificateIntegrity(
  certificateId: string
): Promise<{ valid: boolean; certificate: RiskCertificate | null }> {
  const supabase = getServiceClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cert, error } = await (supabase as any)
    .from('shift_risk_certificates')
    .select('id, shift_id, nurse_id, facility_id, credential_status_snapshot, competency_snapshot, compliance_score, competency_score, alternative_candidates_available, decision_basis, admin_override, override_justification, override_actor_id, certificate_hash, issued_at, created_at')
    .eq('id', certificateId)
    .single()

  if (error || !cert) {
    console.error('[RiskCertificate] verifyCertificateIntegrity — not found:', error?.message)
    return { valid: false, certificate: null }
  }

  const certificate = cert as RiskCertificate

  // Recompute hash from stored fields
  const recomputedHash = computeCertificateHash({
    shift_id: certificate.shift_id,
    nurse_id: certificate.nurse_id,
    facility_id: certificate.facility_id,
    credential_status_snapshot: certificate.credential_status_snapshot,
    competency_snapshot: certificate.competency_snapshot,
    compliance_score: certificate.compliance_score,
    competency_score: certificate.competency_score,
    decision_basis: certificate.decision_basis,
    issued_at: certificate.issued_at,
  })

  const valid = recomputedHash === certificate.certificate_hash

  return { valid, certificate }
}

// ─── PDF Export (HTML) ───────────────────────────────────────────────────────

/**
 * Generate a litigation-ready HTML export of a risk certificate.
 * No PHI — nurse identified by UUID only.
 * Caller converts HTML string to PDF (no external library dependency).
 */
export async function exportCertificatePDF(
  certificateId: string
): Promise<{ html: string }> {
  const { valid, certificate } = await verifyCertificateIntegrity(certificateId)

  if (!certificate) {
    throw new Error(`Certificate not found: ${certificateId}`)
  }

  const integrityBadge = valid
    ? `<span style="color:#16a34a;font-weight:bold;">✓ VERIFIED — Tamper-evident hash matches</span>`
    : `<span style="color:#dc2626;font-weight:bold;">⚠ WARNING — Hash mismatch detected. Record may have been altered.</span>`

  const credRows = certificate.credential_status_snapshot.map((c) => `
    <tr>
      <td>${c.type}</td>
      <td>${c.title}</td>
      <td style="color:${c.status === 'active' ? '#16a34a' : '#dc2626'}">${c.status}</td>
      <td>${c.expiry_date ?? '—'}</td>
    </tr>
  `).join('')

  const compRows = certificate.competency_snapshot.map((c) => `
    <tr>
      <td>${c.unit_type}</td>
      <td>${c.hours_last_12mo}h</td>
      <td>${c.competency_score}/100</td>
      <td>${(c.recency_index * 100).toFixed(0)}%</td>
      <td>${c.verified ? '✓ Verified' : '—'}</td>
    </tr>
  `).join('')

  const overrideSection = certificate.admin_override
    ? `
    <div style="border:2px solid #f59e0b;background:#fffbeb;padding:16px;margin:16px 0;border-radius:6px;">
      <h3 style="color:#b45309;margin:0 0 8px">⚠ Admin Override Applied</h3>
      <p><strong>Override Actor ID:</strong> ${certificate.override_actor_id ?? '—'}</p>
      <p><strong>Justification:</strong> ${certificate.override_justification ?? '—'}</p>
    </div>`
    : ''

  const criteriaList = certificate.decision_basis.criteria_met
    .map((c) => `<li>${c}</li>`)
    .join('')

  const overrideList = certificate.decision_basis.overrides
    .map((o) => `<li>${o}</li>`)
    .join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NurseSphere Risk Certificate — ${certificate.id}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 13px; color: #111; max-width: 900px; margin: 0 auto; padding: 24px; }
    h1 { color: #1d4ed8; border-bottom: 2px solid #1d4ed8; padding-bottom: 8px; }
    h2 { color: #1e40af; margin-top: 24px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    th { background: #1d4ed8; color: white; padding: 8px; text-align: left; }
    td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
    tr:nth-child(even) { background: #f9fafb; }
    .meta { background: #f3f4f6; padding: 12px; border-radius: 6px; margin: 12px 0; }
    .meta p { margin: 4px 0; }
    .score-box { display: inline-block; background: #dbeafe; color: #1d4ed8; padding: 4px 12px; border-radius: 4px; font-size: 18px; font-weight: bold; }
    .footer { margin-top: 32px; border-top: 1px solid #d1d5db; padding-top: 12px; font-size: 11px; color: #6b7280; }
    ul { margin: 4px 0; padding-left: 20px; }
  </style>
</head>
<body>
  <h1>🛡 NurseSphere — Staffing Risk Certificate</h1>
  <p><em>This certificate is an immutable, tamper-evident record of a staffing decision for litigation defense purposes. No patient health information (PHI) is contained in this document.</em></p>

  <div class="meta">
    <p><strong>Certificate ID:</strong> ${certificate.id}</p>
    <p><strong>Issued At:</strong> ${new Date(certificate.issued_at).toUTCString()}</p>
    <p><strong>Shift ID:</strong> ${certificate.shift_id}</p>
    <p><strong>Nurse ID:</strong> ${certificate.nurse_id}</p>
    <p><strong>Facility ID:</strong> ${certificate.facility_id}</p>
    <p><strong>Integrity:</strong> ${integrityBadge}</p>
    <p><strong>Certificate Hash (SHA-256):</strong> <code style="font-size:11px;">${certificate.certificate_hash ?? 'not computed'}</code></p>
  </div>

  <h2>Staffing Scores</h2>
  <p>Compliance Score: <span class="score-box">${certificate.compliance_score}%</span></p>
  <p>Competency Score: <span class="score-box">${certificate.competency_score}/100</span></p>
  <p>Alternative Candidates Available: <strong>${certificate.alternative_candidates_available}</strong></p>

  ${overrideSection}

  <h2>Decision Basis</h2>
  <h3>Criteria Met</h3>
  <ul>${criteriaList || '<li>No explicit criteria recorded</li>'}</ul>
  ${overrideList ? `<h3>Overrides Applied</h3><ul>${overrideList}</ul>` : ''}

  <h2>Credential Status at Time of Assignment</h2>
  <table>
    <thead><tr><th>Type</th><th>Title</th><th>Status</th><th>Expiry Date</th></tr></thead>
    <tbody>${credRows || '<tr><td colspan="4">No credentials on record</td></tr>'}</tbody>
  </table>

  <h2>Competency Snapshot</h2>
  <table>
    <thead><tr><th>Unit Type</th><th>Hours (12mo)</th><th>Score</th><th>Recency</th><th>Verified</th></tr></thead>
    <tbody>${compRows || '<tr><td colspan="5">No competencies on record</td></tr>'}</tbody>
  </table>

  <div class="footer">
    <p>Generated by NurseSphere Litigation Defense Engine. Certificate ID: ${certificate.id}</p>
    <p>SHA-256: ${certificate.certificate_hash ?? 'N/A'}</p>
    <p>Issued: ${certificate.issued_at} | Created: ${certificate.created_at}</p>
    <p>⚠ This document may not be altered. Unauthorized modification invalidates the certificate hash and constitutes tampering with a business record.</p>
  </div>
</body>
</html>`

  return { html }
}
