'use client'

/**
 * Nurse: Marketplace Preferences
 * /marketplace/preferences
 *
 * Lets nurses configure their marketplace preferences:
 * max commute, preferred shift types, min rate, marketplace visibility.
 */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import {
  ArrowLeft,
  Save,
  Loader2,
  CheckCircle,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MarketplacePrefs {
  max_commute_miles: number
  preferred_shift_types: string[]
  preferred_units: string[]
  preferred_roles: string[]
  min_hourly_rate: number
  available_days: string[]
  marketplace_visible: boolean
}

const SHIFT_TYPES = ['day', 'night', 'weekend', 'prn'] as const
const DAYS_OF_WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const COMMON_UNITS = ['ICU', 'ED', 'NICU', 'Med-Surg', 'PICU', 'OR', 'PACU', 'Telemetry', 'Oncology', 'Psych', 'L&D']
const COMMON_ROLES = ['RN', 'LPN', 'CNA', 'NP', 'PA', 'CNS']

const DEFAULT_PREFS: MarketplacePrefs = {
  max_commute_miles: 50,
  preferred_shift_types: [],
  preferred_units: [],
  preferred_roles: [],
  min_hourly_rate: 0,
  available_days: [],
  marketplace_visible: true,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toggleItem<T>(arr: T[], item: T): T[] {
  return arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item]
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MarketplacePreferencesPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  const [prefs, setPrefs] = useState<MarketplacePrefs>(DEFAULT_PREFS)
  const [fetching, setFetching] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    if (!loading && !user) router.push('/auth/signin')
  }, [user, loading, router])

  const fetchPrefs = useCallback(async () => {
    setFetching(true)
    try {
      const res = await fetch('/api/marketplace/preferences')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (json.preferences) {
        setPrefs({ ...DEFAULT_PREFS, ...json.preferences })
      }
    } catch (err) {
      // Non-fatal — use defaults
      console.warn('Could not load preferences:', err)
    } finally {
      setFetching(false)
    }
  }, [])

  useEffect(() => {
    if (user) fetchPrefs()
  }, [user, fetchPrefs])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaveSuccess(false)
    try {
      const res = await fetch('/api/marketplace/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save preferences')
    } finally {
      setSaving(false)
    }
  }

  const update = <K extends keyof MarketplacePrefs>(key: K, value: MarketplacePrefs[K]) => {
    setPrefs(prev => ({ ...prev, [key]: value }))
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

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/marketplace" className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Marketplace Preferences</h1>
            <p className="text-sm text-gray-500">Customize how you find and receive shift opportunities</p>
          </div>
        </div>

        {/* Success banner */}
        {saveSuccess && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">
            <CheckCircle className="h-4 w-4 shrink-0" />
            Preferences saved successfully
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Marketplace Visibility */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-900">Marketplace Visibility</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Allow facilities to see your profile when reviewing applicants
              </p>
            </div>
            <button
              onClick={() => update('marketplace_visible', !prefs.marketplace_visible)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                prefs.marketplace_visible ? 'bg-indigo-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  prefs.marketplace_visible ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          <div className={`mt-2 flex items-center gap-1.5 text-xs ${prefs.marketplace_visible ? 'text-green-700' : 'text-gray-400'}`}>
            {prefs.marketplace_visible ? (
              <><Eye className="h-3.5 w-3.5" /> Visible in marketplace</>
            ) : (
              <><EyeOff className="h-3.5 w-3.5" /> Hidden from marketplace</>
            )}
          </div>
        </div>

        {/* Max Commute */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-semibold text-gray-900 mb-1">Max Commute Distance</h2>
          <p className="text-sm text-gray-500 mb-4">Maximum distance you're willing to travel for a shift</p>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={5}
              max={200}
              step={5}
              value={prefs.max_commute_miles}
              onChange={e => update('max_commute_miles', parseInt(e.target.value))}
              className="flex-1 h-2 bg-gray-200 rounded-full appearance-none cursor-pointer accent-indigo-600"
            />
            <span className="w-20 text-right font-semibold text-gray-900">
              {prefs.max_commute_miles} mi
            </span>
          </div>
        </div>

        {/* Min Hourly Rate */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-semibold text-gray-900 mb-1">Minimum Hourly Rate</h2>
          <p className="text-sm text-gray-500 mb-4">Only show shifts at or above this rate</p>
          <div className="flex items-center gap-3">
            <span className="text-gray-500">$</span>
            <input
              type="number"
              value={prefs.min_hourly_rate}
              onChange={e => update('min_hourly_rate', Math.max(0, parseFloat(e.target.value) || 0))}
              min={0}
              max={999}
              className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <span className="text-gray-500 text-sm">/hr</span>
          </div>
        </div>

        {/* Preferred Shift Types */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-semibold text-gray-900 mb-1">Preferred Shift Types</h2>
          <p className="text-sm text-gray-500 mb-4">Select all that apply</p>
          <div className="flex flex-wrap gap-2">
            {SHIFT_TYPES.map(type => {
              const selected = prefs.preferred_shift_types.includes(type)
              return (
                <button
                  key={type}
                  onClick={() => update('preferred_shift_types', toggleItem(prefs.preferred_shift_types, type))}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors capitalize ${
                    selected
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {type}
                </button>
              )
            })}
          </div>
        </div>

        {/* Available Days */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-semibold text-gray-900 mb-1">Available Days</h2>
          <p className="text-sm text-gray-500 mb-4">Days you're available to work</p>
          <div className="flex flex-wrap gap-2">
            {DAYS_OF_WEEK.map(day => {
              const selected = prefs.available_days.includes(day)
              return (
                <button
                  key={day}
                  onClick={() => update('available_days', toggleItem(prefs.available_days, day))}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors uppercase tracking-wide ${
                    selected
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {day}
                </button>
              )
            })}
          </div>
        </div>

        {/* Preferred Roles */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-semibold text-gray-900 mb-1">Preferred Roles</h2>
          <p className="text-sm text-gray-500 mb-4">Select roles you're qualified for</p>
          <div className="flex flex-wrap gap-2">
            {COMMON_ROLES.map(role => {
              const selected = prefs.preferred_roles.includes(role)
              return (
                <button
                  key={role}
                  onClick={() => update('preferred_roles', toggleItem(prefs.preferred_roles, role))}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    selected
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {role}
                </button>
              )
            })}
          </div>
        </div>

        {/* Preferred Units */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-semibold text-gray-900 mb-1">Preferred Units</h2>
          <p className="text-sm text-gray-500 mb-4">Select units you prefer to work in</p>
          <div className="flex flex-wrap gap-2">
            {COMMON_UNITS.map(unit => {
              const selected = prefs.preferred_units.includes(unit)
              return (
                <button
                  key={unit}
                  onClick={() => update('preferred_units', toggleItem(prefs.preferred_units, unit))}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    selected
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {unit}
                </button>
              )
            })}
          </div>
        </div>

        {/* Save */}
        <div className="flex justify-end gap-3">
          <Link
            href="/marketplace"
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </Link>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Saving…' : 'Save Preferences'}
          </button>
        </div>
      </div>
    </DashboardLayout>
  )
}
