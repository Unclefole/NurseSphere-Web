'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import {
  Award,
  CheckCircle,
  Clock,
  Plus,
  RefreshCw,
  AlertTriangle,
  TrendingUp,
} from 'lucide-react'
import { UNIT_TYPES } from '@/lib/acuity/competency-service'
import type { UnitType } from '@/lib/acuity/competency-service'

// ─── Types ─────────────────────────────────────────────────────────────────

interface Competency {
  id: string
  nurse_id: string
  unit_type: UnitType
  last_worked_at: string | null
  hours_last_12mo: number
  verified: boolean
  verified_at: string | null
  verified_by: string | null
  recency_index: number
  competency_score: number
  created_at: string
  updated_at: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreBadge(score: number): { label: string; className: string } {
  if (score >= 80) return { label: `${score}`, className: 'bg-green-500/20 text-green-400 border border-green-500/30' }
  if (score >= 60) return { label: `${score}`, className: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' }
  return { label: `${score}`, className: 'bg-red-500/20 text-red-400 border border-red-500/30' }
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function recencyLabel(index: number): string {
  if (index >= 1.0) return 'Last 30 days'
  if (index >= 0.75) return '1–3 months ago'
  if (index >= 0.5) return '3–6 months ago'
  if (index >= 0.25) return '6–12 months ago'
  return 'Never / 12+ months'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NurseCompetenciesPage() {
  const { id: nurseId } = useParams<{ id: string }>()
  const { user, profile } = useAuth()
  const router = useRouter()

  const [competencies, setCompetencies] = useState<Competency[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Form state
  const [form, setForm] = useState({
    unit_type: 'ICU' as UnitType,
    hours_last_12mo: 0,
    last_worked_at: '',
    verified: false,
  })

  // Role guard
  const isAdmin = profile?.role === 'hospital_admin' || profile?.role === 'super_admin'

  const fetchCompetencies = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/nurses/${nurseId}/competencies`)
      if (!res.ok) throw new Error('Failed to load competencies')
      const data = await res.json()
      setCompetencies(data.competencies ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [nurseId])

  useEffect(() => {
    if (!user) {
      router.push('/auth/signin')
      return
    }
    if (!isAdmin) {
      router.push('/dashboard')
      return
    }
    fetchCompetencies()
  }, [user, isAdmin, router, fetchCompetencies])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setSuccessMsg(null)

    try {
      const res = await fetch(`/api/nurses/${nurseId}/competencies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_type: form.unit_type,
          hours_last_12mo: form.hours_last_12mo,
          last_worked_at: form.last_worked_at || null,
          verified: form.verified,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Failed to save competency')
      }

      setSuccessMsg(`${form.unit_type} competency updated successfully.`)
      await fetchCompetencies()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-64">
          <RefreshCw className="w-6 h-6 text-blue-400 animate-spin" />
          <span className="ml-2 text-gray-400">Loading competencies…</span>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Award className="w-6 h-6 text-blue-400" />
              Nurse Competencies
            </h1>
            <p className="text-gray-400 mt-1 text-sm">
              Nurse ID: <code className="text-blue-300">{nurseId}</code>
            </p>
          </div>
          <button
            onClick={fetchCompetencies}
            className="flex items-center gap-2 text-gray-400 hover:text-white text-sm"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        {/* Alerts */}
        {error && (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}
        {successMsg && (
          <div className="flex items-start gap-2 bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg p-3">
            <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="text-sm">{successMsg}</span>
          </div>
        )}

        {/* Competency List */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-gray-700">
            <h2 className="text-white font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-400" />
              Competency Scores by Unit
            </h2>
          </div>

          {competencies.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No competencies recorded yet. Use the form below to add unit competencies.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-xs uppercase border-b border-gray-700">
                    <th className="text-left px-4 py-3">Unit Type</th>
                    <th className="text-left px-4 py-3">Score</th>
                    <th className="text-left px-4 py-3">Hours (12mo)</th>
                    <th className="text-left px-4 py-3">Recency</th>
                    <th className="text-left px-4 py-3">Last Worked</th>
                    <th className="text-left px-4 py-3">Verified</th>
                    <th className="text-left px-4 py-3">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {competencies.map((comp) => {
                    const badge = scoreBadge(comp.competency_score)
                    return (
                      <tr key={comp.id} className="border-b border-gray-700/50 hover:bg-gray-700/20">
                        <td className="px-4 py-3 font-medium text-white">{comp.unit_type}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${badge.className}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-300">{comp.hours_last_12mo}h</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {recencyLabel(comp.recency_index)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-400">{formatDate(comp.last_worked_at)}</td>
                        <td className="px-4 py-3">
                          {comp.verified ? (
                            <span className="flex items-center gap-1 text-green-400 text-xs">
                              <CheckCircle className="w-3 h-3" />
                              Verified
                            </span>
                          ) : (
                            <span className="text-gray-600 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(comp.updated_at)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Add / Update Form */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
          <h2 className="text-white font-semibold flex items-center gap-2 mb-4">
            <Plus className="w-4 h-4 text-blue-400" />
            Add / Update Competency
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Unit Type */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Unit Type</label>
                <select
                  value={form.unit_type}
                  onChange={(e) => setForm((f) => ({ ...f, unit_type: e.target.value as UnitType }))}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
                >
                  {UNIT_TYPES.map((ut) => (
                    <option key={ut} value={ut}>{ut}</option>
                  ))}
                </select>
              </div>

              {/* Hours */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Hours Last 12 Months</label>
                <input
                  type="number"
                  min={0}
                  max={9999}
                  step={0.5}
                  value={form.hours_last_12mo}
                  onChange={(e) => setForm((f) => ({ ...f, hours_last_12mo: parseFloat(e.target.value) || 0 }))}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
                />
              </div>

              {/* Last Worked */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Last Worked Date</label>
                <input
                  type="date"
                  value={form.last_worked_at}
                  onChange={(e) => setForm((f) => ({ ...f, last_worked_at: e.target.value }))}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
                />
              </div>

              {/* Verified toggle */}
              <div className="flex items-center gap-3 pt-6">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.verified}
                    onChange={(e) => setForm((f) => ({ ...f, verified: e.target.checked }))}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
                  <span className="ml-3 text-sm text-gray-300">Mark as Verified</span>
                </label>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white rounded-lg px-5 py-2 text-sm font-medium transition-colors"
            >
              {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {submitting ? 'Saving…' : 'Save Competency'}
            </button>
          </form>
        </div>
      </div>
    </DashboardLayout>
  )
}
