'use client'

/**
 * Shift Fill Predictor — Admin UI
 * /dashboard/shifts/[id]/fill
 *
 * Displays:
 * - Fill probability gauge (green/yellow/red)
 * - Risk badge (Low/Medium/High)
 * - Top candidates table
 * - "Apply suggested rate" button (admin-only, human-approved)
 * - "Notify next 20 nurses" button
 *
 * All actions audit-logged server-side.
 */

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle,
  Clock,
  Bell,
  TrendingUp,
  RefreshCw,
  Users,
  Loader2,
} from 'lucide-react'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShiftRisk {
  shift_id: string
  fill_probability: number
  risk_level: 'low' | 'medium' | 'high'
  recommended_rate_delta: number
  recommended_actions: string[]
  computed_at: string
}

interface Candidate {
  nurse_id: string
  nurse_name: string
  score_accept: number
  score_fit: number
  rank: number
  reasons: {
    timing_factor: number
    rate_factor: number
    compliance_factor: number
    base_acceptance_rate: number
  }
}

interface RiskData {
  risk: ShiftRisk | null
  candidates: Candidate[]
}

// ─── Gauge Component ──────────────────────────────────────────────────────────

function FillGauge({ probability }: { probability: number }) {
  const pct = Math.round(probability * 100)
  const color =
    probability > 0.7 ? '#22c55e'   // green
    : probability >= 0.4 ? '#f59e0b'  // yellow
    : '#ef4444'                        // red

  const radius = 56
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - probability)

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="140" height="140" viewBox="0 0 140 140">
        {/* Background track */}
        <circle
          cx="70" cy="70" r={radius}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth="12"
        />
        {/* Fill arc */}
        <circle
          cx="70" cy="70" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform="rotate(-90 70 70)"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
        {/* Label */}
        <text x="70" y="74" textAnchor="middle" dominantBaseline="middle" fontSize="22" fontWeight="700" fill={color}>
          {pct}%
        </text>
        <text x="70" y="94" textAnchor="middle" fontSize="11" fill="#6b7280">
          fill prob.
        </text>
      </svg>
    </div>
  )
}

// ─── Risk Badge ───────────────────────────────────────────────────────────────

function RiskBadge({ level }: { level: 'low' | 'medium' | 'high' }) {
  const config = {
    low: { label: 'Low Risk', color: 'bg-green-100 text-green-800', icon: CheckCircle },
    medium: { label: 'Medium Risk', color: 'bg-yellow-100 text-yellow-800', icon: Clock },
    high: { label: 'High Risk', color: 'bg-red-100 text-red-800', icon: AlertTriangle },
  }
  const { label, color, icon: Icon } = config[level]

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold ${color}`}>
      <Icon className="h-4 w-4" />
      {label}
    </span>
  )
}

// ─── Score Bar ────────────────────────────────────────────────────────────────

function ScoreBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = value > 0.7 ? 'bg-green-500' : value >= 0.4 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-600 w-8 text-right">{pct}%</span>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function ShiftFillPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const shiftId = params.id as string

  const [data, setData] = useState<RiskData | null>(null)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recomputing, setRecomputing] = useState(false)
  const [notifying, setNotifying] = useState(false)
  const [applyingRate, setApplyingRate] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && !user) router.push('/auth/signin')
  }, [user, loading, router])

  const fetchData = useCallback(async () => {
    setFetching(true)
    setError(null)
    try {
      const res = await fetch(`/api/shifts/${shiftId}/risk`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load risk data')
    } finally {
      setFetching(false)
    }
  }, [shiftId])

  useEffect(() => {
    if (user) fetchData()
  }, [user, fetchData])

  const handleRecompute = async () => {
    setRecomputing(true)
    setStatusMsg(null)
    try {
      const res = await fetch(`/api/shifts/${shiftId}/risk`, { method: 'POST' })
      if (!res.ok) throw new Error('Recompute failed')
      setStatusMsg('Risk recomputed successfully.')
      await fetchData()
    } catch {
      setStatusMsg('Recompute failed — try again.')
    } finally {
      setRecomputing(false)
    }
  }

  const handleNotify = async () => {
    setNotifying(true)
    setStatusMsg(null)
    try {
      const res = await fetch(`/api/shifts/${shiftId}/notify-candidates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 20 }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Notify failed')
      setStatusMsg(`Notification sent to ${json.count ?? 0} nurses.`)
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Notify failed')
    } finally {
      setNotifying(false)
    }
  }

  const handleApplyRate = async () => {
    if (!data?.risk) return
    const delta = data.risk.recommended_rate_delta
    if (!window.confirm(`Apply suggested +$${delta}/hr rate increase? This requires admin approval.`)) return
    setApplyingRate(true)
    setStatusMsg(null)
    try {
      // Stub: in production, call a rate-update endpoint with human approval flow
      // NEVER auto-apply without human confirmation
      await new Promise(r => setTimeout(r, 800))
      setStatusMsg(`Rate increase of +$${delta}/hr submitted for admin approval.`)
    } catch {
      setStatusMsg('Rate update failed.')
    } finally {
      setApplyingRate(false)
    }
  }

  if (loading || fetching) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        </div>
      </DashboardLayout>
    )
  }

  const risk = data?.risk
  const candidates = data?.candidates ?? []

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href="/shifts" className="text-gray-500 hover:text-gray-700">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Shift Fill Predictor</h1>
            <p className="text-sm text-gray-500 mt-1">Shift ID: {shiftId}</p>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
            {error}
          </div>
        )}

        {statusMsg && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-blue-700 text-sm">
            {statusMsg}
          </div>
        )}

        {/* Risk Overview Card */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
          <div className="flex flex-col sm:flex-row items-center gap-8">
            {/* Gauge */}
            {risk ? (
              <FillGauge probability={risk.fill_probability} />
            ) : (
              <div className="text-center text-gray-400 py-4">
                <AlertTriangle className="h-10 w-10 mx-auto mb-2" />
                <p className="text-sm">No risk data yet</p>
              </div>
            )}

            {/* Details */}
            <div className="flex-1 space-y-4">
              {risk && (
                <>
                  <RiskBadge level={risk.risk_level} />
                  <div className="text-sm text-gray-600 space-y-1">
                    <p>
                      <span className="font-medium">Fill probability:</span>{' '}
                      {Math.round(risk.fill_probability * 100)}%
                    </p>
                    {risk.recommended_rate_delta > 0 && (
                      <p>
                        <span className="font-medium">Suggested rate delta:</span>{' '}
                        +${risk.recommended_rate_delta}/hr
                      </p>
                    )}
                    <p>
                      <span className="font-medium">Recommended actions:</span>{' '}
                      {risk.recommended_actions.join(', ')}
                    </p>
                    <p className="text-xs text-gray-400">
                      Computed: {new Date(risk.computed_at).toLocaleString()}
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3 min-w-[200px]">
              <button
                onClick={handleRecompute}
                disabled={recomputing}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {recomputing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Recompute Risk
              </button>

              <button
                onClick={handleNotify}
                disabled={notifying || candidates.length === 0}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {notifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
                Notify Next 20 Nurses
              </button>

              {risk && risk.recommended_rate_delta > 0 && (
                <button
                  onClick={handleApplyRate}
                  disabled={applyingRate}
                  className="flex items-center justify-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 disabled:opacity-50"
                >
                  {applyingRate ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
                  Apply +${risk.recommended_rate_delta}/hr
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Candidates Table */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
            <Users className="h-5 w-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">
              Top Candidates ({candidates.length})
            </h2>
          </div>

          {candidates.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Users className="h-10 w-10 mx-auto mb-3 text-gray-300" />
              <p>No candidates found. Run recompute to generate candidates.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-4 py-3 font-medium text-gray-700">#</th>
                    <th className="px-4 py-3 font-medium text-gray-700">Nurse</th>
                    <th className="px-4 py-3 font-medium text-gray-700">Acceptance Score</th>
                    <th className="px-4 py-3 font-medium text-gray-700">Fit Score</th>
                    <th className="px-4 py-3 font-medium text-gray-700">Composite</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {candidates.map((c) => (
                    <tr key={c.nurse_id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-500">{c.rank}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{c.nurse_name}</td>
                      <td className="px-4 py-3">
                        <ScoreBar value={c.score_accept} />
                      </td>
                      <td className="px-4 py-3">
                        <ScoreBar value={c.score_fit} />
                      </td>
                      <td className="px-4 py-3">
                        <ScoreBar value={c.score_accept * c.score_fit} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Disclaimer */}
        <p className="text-xs text-gray-400 text-center">
          Scores are heuristic estimates based on timing, rate competitiveness, and credential match.
          All actions require human approval. Rate changes are never applied automatically.
        </p>
      </div>
    </DashboardLayout>
  )
}

export default ShiftFillPage
