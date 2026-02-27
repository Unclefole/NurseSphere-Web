'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  Clock,
  XCircle,
  ArrowLeft,
  RefreshCw,
  ShieldCheck,
  PlayCircle,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────

interface VerificationRecord {
  id: string
  verification_type: string
  result: 'clear' | 'flagged' | 'unverified' | 'error'
  verified_at: string
  expires_at: string | null
  notes: string | null
  raw_response: Record<string, unknown> | null
}

interface Credential {
  id: string
  nurse_id: string
  facility_id: string | null
  type: string
  issuing_state: string | null
  number: string | null
  status: string
  expiration_date: string
  verified_at: string | null
  verified_by: string | null
  source: string
  created_at: string
}

interface AlertRow {
  id: string
  alert_type: string
  severity: string
  due_at: string | null
  status: string
  evidence: Record<string, unknown>
  created_at: string
}

interface NurseProfile {
  id: string
  full_name: string
  avatar_url: string | null
}

interface ScoreData {
  score: number
  reasons: Array<{ type: string; credential_type: string; deduction: number; detail: string }>
  computed_at: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

function scoreBadge(score: number) {
  if (score >= 90) return 'bg-green-500/20 text-green-400 border border-green-500/30'
  if (score >= 70) return 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
  return 'bg-red-500/20 text-red-400 border border-red-500/30'
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const VERIFICATION_RESULT_BADGE: Record<
  string,
  { label: string; className: string; emoji: string }
> = {
  clear: {
    label: 'Clear',
    className: 'bg-green-500/20 text-green-400 border border-green-500/30',
    emoji: '✅',
  },
  flagged: {
    label: 'Flagged',
    className: 'bg-red-500/20 text-red-400 border border-red-500/30',
    emoji: '🔴',
  },
  unverified: {
    label: 'Unverified',
    className: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
    emoji: '🟡',
  },
  error: {
    label: 'Error',
    className: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
    emoji: '⚠️',
  },
}

function verificationTypeLabel(type: string): string {
  switch (type) {
    case 'nursys_license': return 'NURSYS License'
    case 'oig_exclusion': return 'OIG LEIE Exclusion'
    case 'background_check': return 'Background Check'
    case 'manual': return 'Manual Review'
    default: return type
  }
}

const STATUS_BADGE: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  active: { label: 'Active', className: 'bg-green-500/20 text-green-400 border border-green-500/30', icon: <CheckCircle className="h-3.5 w-3.5" /> },
  expiring: { label: 'Expiring', className: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30', icon: <Clock className="h-3.5 w-3.5" /> },
  expired: { label: 'Expired', className: 'bg-red-500/20 text-red-400 border border-red-500/30', icon: <XCircle className="h-3.5 w-3.5" /> },
  pending_verification: { label: 'Pending', className: 'bg-blue-500/20 text-blue-400 border border-blue-500/30', icon: <Clock className="h-3.5 w-3.5" /> },
  rejected: { label: 'Rejected', className: 'bg-slate-500/20 text-slate-400 border border-slate-500/30', icon: <XCircle className="h-3.5 w-3.5" /> },
}

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  low: 'bg-slate-500/20 text-slate-400 border border-slate-500/30',
}

// ── Component ──────────────────────────────────────────────────────────────

export default function NurseCompliancePage() {
  const { user, loading, isHospital } = useAuth()
  const router = useRouter()
  const params = useParams()
  const nurseId = params?.id as string

  const [profile, setProfile] = useState<NurseProfile | null>(null)
  const [scoreData, setScoreData] = useState<ScoreData | null>(null)
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [alerts, setAlerts] = useState<AlertRow[]>([])
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [updatingAlertId, setUpdatingAlertId] = useState<string | null>(null)
  const [verificationHistory, setVerificationHistory] = useState<VerificationRecord[]>([])
  const [runningVerification, setRunningVerification] = useState(false)
  const [verificationSummary, setVerificationSummary] = useState<{
    overall: string
    checksRun: number
    flagsFound: number
  } | null>(null)

  useEffect(() => {
    if (!loading && (!user || !isHospital)) {
      router.push('/auth/signin')
    }
  }, [user, loading, isHospital, router])

  const fetchVerificationHistory = useCallback(async () => {
    if (!nurseId) return
    try {
      const res = await fetch(`/api/verification/nurse/${nurseId}`)
      if (res.ok) {
        const d = await res.json()
        setVerificationHistory(d.verifications ?? [])
      }
    } catch {
      // non-fatal: verification history is supplemental
    }
  }, [nurseId])

  const fetchData = useCallback(async () => {
    if (!nurseId) return
    setFetching(true)
    setError(null)
    try {
      const [scoresRes, alertsRes, credsRes, profileRes] = await Promise.all([
        fetch(`/api/compliance/scores?nurse_id=${nurseId}`),
        fetch(`/api/compliance/alerts?nurse_id=${nurseId}&status=open`),
        fetch(`/api/credentials?nurse_id=${nurseId}`),
        fetch(`/api/profiles/${nurseId}`),
      ])

      if (scoresRes.ok) {
        const d = await scoresRes.json()
        setScoreData(d.scores?.[0] ?? null)
      }
      if (alertsRes.ok) {
        const d = await alertsRes.json()
        setAlerts(d.alerts ?? [])
      }
      if (credsRes.ok) {
        const d = await credsRes.json()
        setCredentials(d.credentials ?? [])
      }
      if (profileRes.ok) {
        const d = await profileRes.json()
        setProfile(d.profile ?? null)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setFetching(false)
    }
  }, [nurseId])

  useEffect(() => {
    if (!loading && user && isHospital) {
      fetchData()
      fetchVerificationHistory()
    }
  }, [loading, user, isHospital, fetchData, fetchVerificationHistory])

  async function runVerification() {
    setRunningVerification(true)
    setError(null)
    setVerificationSummary(null)
    try {
      const res = await fetch(`/api/verification/nurse/${nurseId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Verification failed')
      const s = d.summary
      setVerificationSummary({
        overall: s.overall,
        checksRun: s.checksRun,
        flagsFound: s.flagsFound,
      })
      // Refresh both verification history and compliance data
      await Promise.all([fetchVerificationHistory(), fetchData()])
    } catch (err) {
      setError(String(err))
    } finally {
      setRunningVerification(false)
    }
  }

  async function verifyCredential(credentialId: string) {
    setVerifyingId(credentialId)
    try {
      const res = await fetch('/api/credentials/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential_id: credentialId }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Verification failed')
      }
      await fetchData()
    } catch (err) {
      setError(String(err))
    } finally {
      setVerifyingId(null)
    }
  }

  async function updateAlert(alertId: string, action: 'acknowledge' | 'resolve') {
    setUpdatingAlertId(alertId)
    try {
      const res = await fetch('/api/compliance/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alert_id: alertId, action }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Update failed')
      }
      await fetchData()
    } catch (err) {
      setError(String(err))
    } finally {
      setUpdatingAlertId(null)
    }
  }

  if (loading || fetching) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back link */}
        <Link
          href="/dashboard/compliance"
          className="flex items-center gap-1 text-slate-400 hover:text-white text-sm mb-6 w-fit transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Compliance Overview
        </Link>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Nurse header */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-6 flex items-center gap-6">
          <div className="h-16 w-16 rounded-full bg-slate-600 flex items-center justify-center text-2xl font-bold text-white">
            {profile?.full_name?.charAt(0) ?? '?'}
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-white">{profile?.full_name ?? 'Nurse'}</h1>
            <div className="text-sm text-slate-400 mt-1">
              Compliance Report · Last computed {formatDate(scoreData?.computed_at)}
            </div>
          </div>
          {scoreData !== null && (
            <div className="text-right">
              <div className={`inline-flex px-4 py-2 rounded-xl text-3xl font-bold ${scoreBadge(scoreData?.score ?? 0)}`}>
                {scoreData?.score ?? '—'}
              </div>
              <div className="text-xs text-slate-400 mt-1">Compliance Score</div>
            </div>
          )}
          {scoreData === null && (
            <div className="text-slate-500 text-sm">No score computed yet</div>
          )}
        </div>

        {/* Score reasons */}
        {scoreData && scoreData.reasons.length > 0 && (
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 mb-6">
            <h2 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-400" /> Score Deductions
            </h2>
            <div className="space-y-2">
              {scoreData.reasons.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-slate-300">{r.detail}</span>
                  <span className="text-red-400 font-semibold">-{r.deduction}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Credentials table */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-blue-400" />
            <h2 className="font-semibold text-white">Credentials</h2>
            <span className="text-slate-500 text-xs">({credentials.length})</span>
          </div>
          {credentials.length === 0 ? (
            <div className="py-10 text-center text-slate-500 text-sm">
              No credentials on file for this nurse.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Type</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Status</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Expires</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Verified</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {credentials.map((cred) => {
                  const badge = STATUS_BADGE[cred.status] ?? STATUS_BADGE['pending_verification']
                  return (
                    <tr key={cred.id} className="border-b border-slate-700/50">
                      <td className="px-4 py-3">
                        <span className="text-white font-medium">{cred.type}</span>
                        {cred.issuing_state && (
                          <span className="text-slate-400 ml-1 text-xs">({cred.issuing_state})</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
                          {badge.icon} {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{formatDate(cred.expiration_date)}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">
                        {cred.verified_at ? formatDate(cred.verified_at) : <span className="text-slate-500">Not verified</span>}
                      </td>
                      <td className="px-4 py-3">
                        {cred.status === 'pending_verification' && (
                          <button
                            onClick={() => verifyCredential(cred.id)}
                            disabled={verifyingId === cred.id}
                            className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded text-xs font-medium transition-colors flex items-center gap-1"
                          >
                            {verifyingId === cred.id ? (
                              <RefreshCw className="h-3 w-3 animate-spin" />
                            ) : (
                              <CheckCircle className="h-3 w-3" />
                            )}
                            Verify
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Verification Section ─────────────────────────────────────────── */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-purple-400" />
              <h2 className="font-semibold text-white">Primary Source Verification</h2>
              <span className="text-slate-500 text-xs">NURSYS · OIG LEIE</span>
            </div>
            <button
              onClick={runVerification}
              disabled={runningVerification}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors"
            >
              {runningVerification ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlayCircle className="h-3.5 w-3.5" />
              )}
              {runningVerification ? 'Running…' : 'Run Verification'}
            </button>
          </div>

          {/* Run result banner */}
          {verificationSummary && (
            <div
              className={`px-4 py-2.5 text-sm flex items-center gap-2 border-b border-slate-700 ${
                verificationSummary.overall === 'flagged'
                  ? 'bg-red-500/10 text-red-300'
                  : verificationSummary.overall === 'clear'
                  ? 'bg-green-500/10 text-green-300'
                  : 'bg-yellow-500/10 text-yellow-300'
              }`}
            >
              {verificationSummary.overall === 'flagged' ? '🔴' : verificationSummary.overall === 'clear' ? '✅' : '🟡'}
              <span className="font-medium capitalize">{verificationSummary.overall}</span>
              <span className="text-slate-400">
                — {verificationSummary.checksRun} check{verificationSummary.checksRun !== 1 ? 's' : ''} run
                {verificationSummary.flagsFound > 0 && (
                  <span className="text-red-400 ml-1">· {verificationSummary.flagsFound} flag{verificationSummary.flagsFound !== 1 ? 's' : ''} found</span>
                )}
              </span>
            </div>
          )}

          {/* Verification history table */}
          {verificationHistory.length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-sm">
              No verifications run yet. Click &quot;Run Verification&quot; to start.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Check</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Result</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Verified At</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Re-verify By</th>
                  <th className="text-left px-4 py-3 text-slate-400 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {verificationHistory.map((v) => {
                  const badge =
                    VERIFICATION_RESULT_BADGE[v.result] ?? VERIFICATION_RESULT_BADGE['unverified']
                  return (
                    <tr key={v.id} className="border-b border-slate-700/50">
                      <td className="px-4 py-3 text-white font-medium">
                        {verificationTypeLabel(v.verification_type)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}
                        >
                          {badge.emoji} {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-xs">
                        {formatDate(v.verified_at)}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">
                        {v.expires_at ? formatDate(v.expires_at) : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        {v.notes ?? '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Active alerts */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-400" />
            <h2 className="font-semibold text-white">Open Alerts</h2>
            <span className="text-slate-500 text-xs">({alerts.length})</span>
          </div>
          {alerts.length === 0 ? (
            <div className="py-10 text-center text-green-400 text-sm flex flex-col items-center gap-2">
              <CheckCircle className="h-6 w-6" />
              No open compliance alerts
            </div>
          ) : (
            <div className="divide-y divide-slate-700/50">
              {alerts.map((alert) => (
                <div key={alert.id} className="px-4 py-4 flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${SEVERITY_BADGE[alert.severity] ?? ''}`}>
                        {alert.severity.toUpperCase()}
                      </span>
                      <span className="text-white text-sm font-medium">{alert.alert_type.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="text-xs text-slate-400">
                      {Boolean(alert.evidence?.type) && <span className="mr-2">Type: {String(alert.evidence?.type)}</span>}
                      {alert.due_at && <span>Due: {formatDate(alert.due_at)}</span>}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {alert.status === 'open' && (
                      <button
                        onClick={() => updateAlert(alert.id, 'acknowledge')}
                        disabled={updatingAlertId === alert.id}
                        className="px-2.5 py-1 bg-yellow-600/20 border border-yellow-600/40 hover:bg-yellow-600/30 text-yellow-300 rounded text-xs transition-colors"
                      >
                        Acknowledge
                      </button>
                    )}
                    <button
                      onClick={() => updateAlert(alert.id, 'resolve')}
                      disabled={updatingAlertId === alert.id}
                      className="px-2.5 py-1 bg-green-600/20 border border-green-600/40 hover:bg-green-600/30 text-green-300 rounded text-xs transition-colors"
                    >
                      {updatingAlertId === alert.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : 'Resolve'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
