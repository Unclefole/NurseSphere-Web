'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import {
  Calendar,
  Clock,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Zap,
} from 'lucide-react'
import { UNIT_TYPES } from '@/lib/acuity/competency-service'
import type { UnitType } from '@/lib/acuity/competency-service'

// ─── Types ─────────────────────────────────────────────────────────────────

type AcuityLevel = 'low' | 'moderate' | 'high' | 'critical'

const ACUITY_OPTIONS: { value: AcuityLevel; label: string; description: string; color: string }[] = [
  { value: 'low', label: 'Low', description: 'Standard care, no special competency required', color: 'text-green-400' },
  { value: 'moderate', label: 'Moderate', description: 'Intermediate care, warns if below threshold', color: 'text-yellow-400' },
  { value: 'high', label: 'High', description: 'Complex care — blocks nurses below threshold', color: 'text-orange-400' },
  { value: 'critical', label: 'Critical', description: 'ICU/critical care — strict competency enforcement', color: 'text-red-400' },
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function NewShiftPage() {
  const { user } = useAuth()
  const router = useRouter()

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const [form, setForm] = useState({
    title: '',
    startTime: '',
    endTime: '',
    hourlyRate: '',
    specialty: '',
    acuityLevel: '' as AcuityLevel | '',
    requiredCompetencies: [] as UnitType[],
    minimumCompetencyScore: 60,
    acuityNotes: '',
  })

  const showCompetencyScore = form.acuityLevel === 'high' || form.acuityLevel === 'critical'

  const toggleCompetency = (unitType: UnitType) => {
    setForm((f) => ({
      ...f,
      requiredCompetencies: f.requiredCompetencies.includes(unitType)
        ? f.requiredCompetencies.filter((u) => u !== unitType)
        : [...f.requiredCompetencies, unitType],
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return

    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facilityId: (user as { user_metadata?: { facility_id?: string } }).user_metadata?.facility_id,
          title: form.title,
          startTime: new Date(form.startTime).toISOString(),
          endTime: new Date(form.endTime).toISOString(),
          hourlyRate: form.hourlyRate ? parseFloat(form.hourlyRate) : undefined,
          specialty: form.specialty || undefined,
          acuityLevel: form.acuityLevel || undefined,
          requiredCompetencies: form.requiredCompetencies,
          minimumCompetencyScore: form.minimumCompetencyScore,
          acuityNotes: form.acuityNotes || undefined,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? err.message ?? 'Failed to create shift')
      }

      setSuccess(true)
      setTimeout(() => router.push('/dashboard'), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create shift')
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center min-h-64 gap-3">
          <CheckCircle className="w-12 h-12 text-green-400" />
          <p className="text-white text-lg font-semibold">Shift created successfully!</p>
          <p className="text-gray-400 text-sm">Redirecting to dashboard…</p>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Calendar className="w-6 h-6 text-blue-400" />
            Post New Shift
          </h1>
          <p className="text-gray-400 mt-1 text-sm">
            Create a shift posting. Acuity settings enforce competency matching.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Basic Info */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5 space-y-4">
            <h2 className="text-white font-semibold text-sm uppercase tracking-wide">Shift Details</h2>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Shift Title *</label>
              <input
                required
                type="text"
                placeholder="e.g. Night Shift ICU RN"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  <Clock className="w-3 h-3 inline mr-1" />Start Time *
                </label>
                <input
                  required
                  type="datetime-local"
                  value={form.startTime}
                  onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  <Clock className="w-3 h-3 inline mr-1" />End Time *
                </label>
                <input
                  required
                  type="datetime-local"
                  value={form.endTime}
                  onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  <DollarSign className="w-3 h-3 inline mr-1" />Hourly Rate
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.50}
                  placeholder="45.00"
                  value={form.hourlyRate}
                  onChange={(e) => setForm((f) => ({ ...f, hourlyRate: e.target.value }))}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Specialty</label>
                <input
                  type="text"
                  placeholder="e.g. Critical Care"
                  value={form.specialty}
                  onChange={(e) => setForm((f) => ({ ...f, specialty: e.target.value }))}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Acuity Classification */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5 space-y-4">
            <h2 className="text-white font-semibold text-sm uppercase tracking-wide flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-400" />
              Acuity Classification
            </h2>

            <div>
              <label className="block text-sm text-gray-400 mb-2">Acuity Level</label>
              <div className="grid grid-cols-2 gap-2">
                {ACUITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, acuityLevel: opt.value }))}
                    className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                      form.acuityLevel === opt.value
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-gray-600 bg-gray-700/50 hover:border-gray-500'
                    }`}
                  >
                    <div className={`font-medium ${opt.color}`}>{opt.label}</div>
                    <div className="text-gray-500 text-xs mt-0.5">{opt.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Required Competencies (multi-select) */}
            {form.acuityLevel && form.acuityLevel !== 'low' && (
              <div>
                <label className="block text-sm text-gray-400 mb-2">Required Competencies</label>
                <div className="flex flex-wrap gap-2">
                  {UNIT_TYPES.map((ut) => (
                    <button
                      key={ut}
                      type="button"
                      onClick={() => toggleCompetency(ut)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                        form.requiredCompetencies.includes(ut)
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-500'
                      }`}
                    >
                      {ut}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Minimum Competency Score (only for high/critical) */}
            {showCompetencyScore && (
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  Minimum Competency Score
                  <span className="text-gray-500 ml-1">(0–100, blocks nurses below this score)</span>
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.minimumCompetencyScore}
                  onChange={(e) => setForm((f) => ({ ...f, minimumCompetencyScore: parseInt(e.target.value) || 60 }))}
                  className="w-32 bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
                />
              </div>
            )}

            {/* Acuity Notes */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Acuity Notes <span className="text-gray-600">(internal admin notes, not visible to nurses)</span>
              </label>
              <textarea
                rows={2}
                placeholder="Internal notes about acuity requirements…"
                value={form.acuityNotes}
                onChange={(e) => setForm((f) => ({ ...f, acuityNotes: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm resize-none"
              />
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white rounded-lg px-5 py-3 font-medium transition-colors"
          >
            {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
            {submitting ? 'Posting Shift…' : 'Post Shift'}
          </button>
        </form>
      </div>
    </DashboardLayout>
  )
}
