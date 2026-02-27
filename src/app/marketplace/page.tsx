'use client'

/**
 * Shift Marketplace — Nurse browse page
 * /marketplace
 *
 * Nurses browse open shifts across ALL facilities they are eligible for.
 * Filter sidebar: role, unit, date range, min rate, shift type.
 * Apply directly from the card.
 */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import {
  Search,
  Filter,
  MapPin,
  Clock,
  DollarSign,
  Building2,
  Briefcase,
  Calendar,
  Loader2,
  CheckCircle,
  AlertCircle,
  X,
} from 'lucide-react'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MarketplaceShift {
  id: string
  facility_id: string
  facility_name: string
  facility_city: string | null
  facility_state: string | null
  title: string
  start_time: string
  end_time: string
  hourly_rate: number
  specialty_required: string | null
  description: string | null
  status: string
  application_count: number
  created_at: string
}

interface Filters {
  role: string
  unit: string
  minRate: string
  date: string
  shiftType: 'all' | 'day' | 'night' | 'weekend'
}

// ─── Shift Type Badge ─────────────────────────────────────────────────────────

function ShiftTypeBadge({ startTime }: { startTime: string }) {
  const hour = new Date(startTime).getHours()
  let label: string
  let colorClass: string

  const day = new Date(startTime).getDay() // 0=Sun, 6=Sat
  if (day === 0 || day === 6) {
    label = 'Weekend'
    colorClass = 'bg-purple-100 text-purple-700'
  } else if (hour >= 6 && hour < 18) {
    label = 'Day'
    colorClass = 'bg-amber-100 text-amber-700'
  } else {
    label = 'Night'
    colorClass = 'bg-indigo-100 text-indigo-700'
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${colorClass}`}>
      {label}
    </span>
  )
}

// ─── Shift Card ───────────────────────────────────────────────────────────────

function ShiftCard({
  shift,
  onApply,
  applying,
  applied,
}: {
  shift: MarketplaceShift
  onApply: (id: string) => void
  applying: boolean
  applied: boolean
}) {
  const start = new Date(shift.start_time)
  const end = new Date(shift.end_time)
  const hours = Math.round((end.getTime() - start.getTime()) / 3_600_000)

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{shift.title}</h3>
          <p className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
            <Building2 className="h-3.5 w-3.5 shrink-0" />
            {shift.facility_name}
            {shift.facility_city && (
              <span className="text-gray-400">
                · {shift.facility_city}{shift.facility_state ? `, ${shift.facility_state}` : ''}
              </span>
            )}
          </p>
        </div>
        <ShiftTypeBadge startTime={shift.start_time} />
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm text-gray-600">
        <div className="flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5 text-gray-400 shrink-0" />
          {start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-gray-400 shrink-0" />
          {start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · {hours}h
        </div>
        {shift.specialty_required && (
          <div className="flex items-center gap-1.5">
            <Briefcase className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            {shift.specialty_required}
          </div>
        )}
        <div className="flex items-center gap-1.5 font-semibold text-emerald-700">
          <DollarSign className="h-3.5 w-3.5 shrink-0" />
          ${shift.hourly_rate}/hr
        </div>
      </div>

      {/* Application count */}
      {shift.application_count > 0 && (
        <p className="text-xs text-gray-400">
          {shift.application_count} pending {shift.application_count === 1 ? 'application' : 'applications'}
        </p>
      )}

      {/* Apply button */}
      {applied ? (
        <div className="flex items-center gap-2 text-emerald-700 text-sm font-medium pt-1">
          <CheckCircle className="h-4 w-4" />
          Application Submitted
        </div>
      ) : (
        <button
          onClick={() => onApply(shift.id)}
          disabled={applying}
          className="mt-1 w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {applying ? 'Applying…' : 'Apply Now'}
        </button>
      )}
    </div>
  )
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function ShiftSkeleton() {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 animate-pulse">
      <div className="h-5 bg-gray-200 rounded w-2/3 mb-2" />
      <div className="h-4 bg-gray-100 rounded w-1/2 mb-4" />
      <div className="grid grid-cols-2 gap-2 mb-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-4 bg-gray-100 rounded" />
        ))}
      </div>
      <div className="h-9 bg-gray-200 rounded-lg" />
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MarketplacePage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  const [shifts, setShifts] = useState<MarketplaceShift[]>([])
  const [total, setTotal] = useState(0)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set())
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)

  const [filters, setFilters] = useState<Filters>({
    role: '',
    unit: '',
    minRate: '',
    date: '',
    shiftType: 'all',
  })

  // Auth guard
  useEffect(() => {
    if (!loading && !user) router.push('/auth/signin')
  }, [user, loading, router])

  const fetchShifts = useCallback(async () => {
    setFetching(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filters.role)     params.set('role', filters.role)
      if (filters.unit)     params.set('unit', filters.unit)
      if (filters.minRate)  params.set('min_rate', filters.minRate)
      if (filters.date)     params.set('date', filters.date)
      if (filters.shiftType !== 'all') params.set('shift_type', filters.shiftType)

      const res = await fetch(`/api/marketplace/shifts?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setShifts(json.shifts ?? [])
      setTotal(json.total ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shifts')
    } finally {
      setFetching(false)
    }
  }, [filters])

  useEffect(() => {
    if (user) fetchShifts()
  }, [user, fetchShifts])

  const handleApply = async (shiftId: string) => {
    setApplyingId(shiftId)
    setApplyError(null)
    try {
      const res = await fetch('/api/marketplace/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shift_id: shiftId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.message ?? json.error ?? 'Apply failed')
      setAppliedIds(prev => new Set([...prev, shiftId]))
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Failed to apply')
    } finally {
      setApplyingId(null)
    }
  }

  const clearFilter = (key: keyof Filters) => {
    setFilters(prev => ({ ...prev, [key]: key === 'shiftType' ? 'all' : '' }))
  }

  const activeFilterCount = Object.entries(filters).filter(([k, v]) =>
    k === 'shiftType' ? v !== 'all' : Boolean(v)
  ).length

  if (loading) {
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
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Shift Marketplace</h1>
            <p className="text-sm text-gray-500 mt-1">
              Browse open shifts across all facilities
              {!fetching && ` · ${total} available`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/marketplace/my-applications"
              className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
            >
              My Applications →
            </Link>
            <button
              onClick={() => setShowFilters(v => !v)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                showFilters || activeFilterCount > 0
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Filter className="h-4 w-4" />
              Filters
              {activeFilterCount > 0 && (
                <span className="ml-1 bg-indigo-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Apply error banner */}
        {applyError && (
          <div className="mb-4 flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {applyError}
            <button onClick={() => setApplyError(null)} className="ml-auto">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="flex gap-6">
          {/* Filter Sidebar */}
          {showFilters && (
            <aside className="w-72 shrink-0">
              <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-5 sticky top-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-gray-900">Filters</h2>
                  {activeFilterCount > 0 && (
                    <button
                      onClick={() => setFilters({ role: '', unit: '', minRate: '', date: '', shiftType: 'all' })}
                      className="text-xs text-indigo-600 hover:text-indigo-700"
                    >
                      Clear all
                    </button>
                  )}
                </div>

                {/* Role */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Role / Specialty</label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      value={filters.role}
                      onChange={e => setFilters(f => ({ ...f, role: e.target.value }))}
                      placeholder="e.g. RN, ICU, CNA"
                      className="w-full pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                    {filters.role && (
                      <button
                        onClick={() => clearFilter('role')}
                        className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Unit */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Unit</label>
                  <div className="relative">
                    <MapPin className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      value={filters.unit}
                      onChange={e => setFilters(f => ({ ...f, unit: e.target.value }))}
                      placeholder="e.g. ICU, ED, Med-Surg"
                      className="w-full pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                    {filters.unit && (
                      <button
                        onClick={() => clearFilter('unit')}
                        className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Min Rate */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">
                    Minimum Rate ($/hr)
                  </label>
                  <div className="relative">
                    <DollarSign className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                    <input
                      type="number"
                      value={filters.minRate}
                      onChange={e => setFilters(f => ({ ...f, minRate: e.target.value }))}
                      placeholder="0"
                      min="0"
                      className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>
                </div>

                {/* Date */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Date</label>
                  <div className="relative">
                    <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                    <input
                      type="date"
                      value={filters.date}
                      onChange={e => setFilters(f => ({ ...f, date: e.target.value }))}
                      className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>
                </div>

                {/* Shift Type */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Shift Type</label>
                  <div className="flex flex-col gap-1.5">
                    {(['all', 'day', 'night', 'weekend'] as const).map(type => (
                      <label key={type} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="shiftType"
                          value={type}
                          checked={filters.shiftType === type}
                          onChange={() => setFilters(f => ({ ...f, shiftType: type }))}
                          className="text-indigo-600"
                        />
                        <span className="text-sm text-gray-700 capitalize">{type === 'all' ? 'All shifts' : `${type} shifts`}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <button
                  onClick={fetchShifts}
                  className="w-full py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
                >
                  Apply Filters
                </button>
              </div>
            </aside>
          )}

          {/* Shifts Grid */}
          <div className="flex-1 min-w-0">
            {fetching ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <ShiftSkeleton key={i} />
                ))}
              </div>
            ) : error ? (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-6 text-center">
                <AlertCircle className="h-8 w-8 mx-auto mb-2" />
                <p className="font-medium">Failed to load shifts</p>
                <p className="text-sm mt-1">{error}</p>
                <button
                  onClick={fetchShifts}
                  className="mt-3 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  Retry
                </button>
              </div>
            ) : shifts.length === 0 ? (
              <div className="text-center py-20">
                <Briefcase className="h-12 w-12 mx-auto text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-700">No open shifts match your filters</h3>
                <p className="text-sm text-gray-500 mt-2">
                  Try adjusting your filters or check back later.
                </p>
                {activeFilterCount > 0 && (
                  <button
                    onClick={() => setFilters({ role: '', unit: '', minRate: '', date: '', shiftType: 'all' })}
                    className="mt-4 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                  >
                    Clear all filters
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {shifts.map(shift => (
                  <ShiftCard
                    key={shift.id}
                    shift={shift}
                    onApply={handleApply}
                    applying={applyingId === shift.id}
                    applied={appliedIds.has(shift.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
