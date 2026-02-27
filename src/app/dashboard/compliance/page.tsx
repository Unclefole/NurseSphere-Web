'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  Clock,
  RefreshCw,
  ChevronRight,
  Filter,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

interface ScoreRow {
  id: string
  facility_id: string
  nurse_id: string
  score: number
  reasons: Array<{ type: string; credential_type: string; deduction: number; detail: string }>
  computed_at: string
  profiles: { id: string; full_name: string; avatar_url: string | null } | null
  // joined from separate alert query
  open_alerts?: number
  next_expiry?: { date: string; type: string } | null
}

type ScoreRange = 'all' | 'green' | 'yellow' | 'red'
type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low'

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreBadge(score: number): { label: string; className: string } {
  if (score >= 90) return { label: `${score}`, className: 'bg-green-500/20 text-green-400 border border-green-500/30' }
  if (score >= 70) return { label: `${score}`, className: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' }
  return { label: `${score}`, className: 'bg-red-500/20 text-red-400 border border-red-500/30' }
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ComplianceDashboardPage() {
  const { user, loading, isHospital } = useAuth()
  const router = useRouter()

  const [scores, setScores] = useState<ScoreRow[]>([])
  const [fetching, setFetching] = useState(true)
  const [sweeping, setSweeping] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [scoreRange, setScoreRange] = useState<ScoreRange>('all')
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [alertsMap, setAlertsMap] = useState<Record<string, { count: number; next_expiry: { date: string; type: string } | null }>>({})

  // Redirect if not hospital admin
  useEffect(() => {
    if (!loading && (!user || !isHospital)) {
      router.push('/auth/signin')
    }
  }, [user, loading, isHospital, router])

  const fetchData = useCallback(async () => {
    setFetching(true)
    setError(null)
    try {
      const [scoresRes, alertsRes] = await Promise.all([
        fetch('/api/compliance/scores'),
        fetch('/api/compliance/alerts?status=open'),
      ])

      if (!scoresRes.ok) throw new Error('Failed to load compliance scores')
      if (!alertsRes.ok) throw new Error('Failed to load compliance alerts')

      const scoresData = await scoresRes.json()
      const alertsData = await alertsRes.json()

      // Build alert map keyed by nurse_id
      const map: typeof alertsMap = {}
      for (const alert of alertsData.alerts ?? []) {
        if (!map[alert.nurse_id]) {
          map[alert.nurse_id] = { count: 0, next_expiry: null }
        }
        map[alert.nurse_id].count++
        if (alert.due_at && !map[alert.nurse_id].next_expiry) {
          map[alert.nurse_id].next_expiry = {
            date: alert.due_at,
            type: alert.evidence?.type ?? '—',
          }
        }
      }
      setAlertsMap(map)
      setScores(scoresData.scores ?? [])
    } catch (err) {
      setError(String(err))
    } finally {
      setFetching(false)
    }
  }, [])

  useEffect(() => {
    if (!loading && user && isHospital) {
      fetchData()
    }
  }, [loading, user, isHospital, fetchData])

  async function triggerSweep() {
    setSweeping(true)
    try {
      const res = await fetch('/api/compliance/sweep', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Sweep failed')
      await fetchData()
    } catch (err) {
      setError(String(err))
    } finally {
      setSweeping(false)
    }
  }

  // Apply filters
  const filtered = scores.filter((row) => {
    if (scoreRange === 'green' && row.score < 90) return false
    if (scoreRange === 'yellow' && (row.score < 70 || row.score >= 90)) return false
    if (scoreRange === 'red' && row.score >= 70) return false
    if (severityFilter !== 'all') {
      // Check if nurse has an open alert of this severity
      // We'd need more data — for now check the reasons
      const hasRelevantReason = row.reasons?.some(
        (r) => r.type === severityFilter || r.type.startsWith('expir')
      )
      if (!hasRelevantReason) return false
    }
    return true
  })

  if (loading) {
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Shield className="h-7 w-7 text-blue-400" />
            <div>
              <h1 className="text-2xl font-bold text-white">Compliance Guardian</h1>
              <p className="text-sm text-slate-400">Monitor nurse credential compliance across your facility</p>
            </div>
          </div>
          <button
            onClick={triggerSweep}
            disabled={sweeping}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${sweeping ? 'animate-spin' : ''}`} />
            {sweeping ? 'Running Sweep…' : 'Run Compliance Sweep'}
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Filter bar */}
        <div className="flex items-center gap-3 mb-4 p-3 bg-slate-800/50 border border-slate-700 rounded-lg">
          <Filter className="h-4 w-4 text-slate-400" />
          <span className="text-sm text-slate-400">Filter:</span>
          <div className="flex gap-2">
            {(['all', 'green', 'yellow', 'red'] as ScoreRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setScoreRange(r)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  scoreRange === r
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {r === 'all' ? 'All Scores' : r === 'green' ? '✅ 90–100' : r === 'yellow' ? '🟡 70–89' : '🔴 <70'}
              </button>
            ))}
          </div>
          <div className="border-l border-slate-600 pl-3 flex gap-2">
            {(['all', 'critical', 'high'] as SeverityFilter[]).map((s) => (
              <button
                key={s}
                onClick={() => setSeverityFilter(s)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  severityFilter === s
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {s === 'all' ? 'All Severity' : s}
              </button>
            ))}
          </div>
        </div>

        {/* Stats summary */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Total Nurses', value: scores.length, icon: <CheckCircle className="h-5 w-5 text-green-400" /> },
            { label: 'Open Alerts', value: Object.values(alertsMap).reduce((a, b) => a + b.count, 0), icon: <AlertTriangle className="h-5 w-5 text-yellow-400" /> },
            { label: 'At Risk (<70)', value: scores.filter((s) => s.score < 70).length, icon: <Shield className="h-5 w-5 text-red-400" /> },
          ].map((stat) => (
            <div key={stat.label} className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 flex items-center gap-3">
              {stat.icon}
              <div>
                <div className="text-xl font-bold text-white">{stat.value}</div>
                <div className="text-xs text-slate-400">{stat.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Nurse</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Score</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Open Alerts</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Next Expiry</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Last Computed</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {fetching ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-500">
                    <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2" />
                    Loading compliance data…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-500">
                    No compliance records found.{' '}
                    <button onClick={triggerSweep} className="text-blue-400 hover:underline">
                      Run a sweep
                    </button>{' '}
                    to generate scores.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => {
                  const badge = scoreBadge(row.score)
                  const alertInfo = alertsMap[row.nurse_id]
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-slate-700/50 hover:bg-slate-700/30 cursor-pointer transition-colors"
                      onClick={() => router.push(`/dashboard/compliance/nurse/${row.nurse_id}`)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-slate-600 flex items-center justify-center text-xs font-semibold text-white">
                            {row.profiles?.full_name?.charAt(0) ?? '?'}
                          </div>
                          <span className="text-white font-medium">
                            {row.profiles?.full_name ?? 'Unknown'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2.5 py-1 rounded-full text-sm font-semibold ${badge.className}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {alertInfo?.count ? (
                          <span className="flex items-center gap-1 text-red-400">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {alertInfo.count}
                          </span>
                        ) : (
                          <span className="text-green-400 flex items-center gap-1">
                            <CheckCircle className="h-3.5 w-3.5" /> 0
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {alertInfo?.next_expiry ? (
                          <span className="flex items-center gap-1 text-slate-300">
                            <Clock className="h-3.5 w-3.5 text-yellow-400" />
                            {alertInfo.next_expiry.type} · {formatDate(alertInfo.next_expiry.date)}
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">
                        {formatDate(row.computed_at)}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/compliance/nurse/${row.nurse_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-blue-400 hover:text-blue-300"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  )
}
