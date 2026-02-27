'use client'

/**
 * Nurse: My Applications
 * /marketplace/my-applications
 *
 * Shows the nurse's own application history with status badges.
 * Allows withdrawing pending applications.
 */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import {
  ArrowLeft,
  Briefcase,
  Calendar,
  Clock,
  DollarSign,
  Building2,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  RotateCcw,
} from 'lucide-react'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

type AppStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'expired'

interface ShiftApplication {
  id: string
  shift_id: string
  facility_id: string
  status: AppStatus
  applied_at: string
  reviewed_at: string | null
  note: string | null
  shifts: {
    id: string
    title: string
    start_time: string
    end_time: string
    hourly_rate: number
    specialty_required: string | null
    status: string
  } | null
  facilities: {
    id: string
    name: string
    city: string | null
    state: string | null
  } | null
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<AppStatus, { label: string; colorClass: string; icon: React.ComponentType<{ className?: string }> }> = {
  pending:   { label: 'Pending',   colorClass: 'bg-yellow-100 text-yellow-800',  icon: Clock },
  accepted:  { label: 'Accepted',  colorClass: 'bg-green-100 text-green-800',    icon: CheckCircle },
  rejected:  { label: 'Rejected',  colorClass: 'bg-red-100 text-red-800',        icon: XCircle },
  withdrawn: { label: 'Withdrawn', colorClass: 'bg-gray-100 text-gray-600',      icon: RotateCcw },
  expired:   { label: 'Expired',   colorClass: 'bg-gray-100 text-gray-500',      icon: AlertCircle },
}

function StatusBadge({ status }: { status: AppStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.expired
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.colorClass}`}>
      <Icon className="h-3.5 w-3.5" />
      {cfg.label}
    </span>
  )
}

// ─── Application Card ─────────────────────────────────────────────────────────

function ApplicationCard({
  app,
  onWithdraw,
  withdrawing,
}: {
  app: ShiftApplication
  onWithdraw: (id: string) => void
  withdrawing: boolean
}) {
  const shift = app.shifts
  const facility = app.facilities

  const start = shift ? new Date(shift.start_time) : null
  const end   = shift ? new Date(shift.end_time) : null
  const hours = start && end ? Math.round((end.getTime() - start.getTime()) / 3_600_000) : null

  const isAccepted = app.status === 'accepted'

  return (
    <div className={`bg-white border rounded-xl shadow-sm p-5 space-y-3 ${isAccepted ? 'border-green-300 ring-1 ring-green-300' : 'border-gray-200'}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{shift?.title ?? 'Shift'}</h3>
          {facility && (
            <p className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              {facility.name}
              {facility.city && <span className="text-gray-400">· {facility.city}{facility.state ? `, ${facility.state}` : ''}</span>}
            </p>
          )}
        </div>
        <StatusBadge status={app.status} />
      </div>

      {/* Shift details */}
      {shift && start && end && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm text-gray-600">
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 text-gray-400" />
            {start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-gray-400" />
            {start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · {hours}h
          </div>
          {shift.specialty_required && (
            <div className="flex items-center gap-1.5">
              <Briefcase className="h-3.5 w-3.5 text-gray-400" />
              {shift.specialty_required}
            </div>
          )}
          <div className="flex items-center gap-1.5 font-semibold text-emerald-700">
            <DollarSign className="h-3.5 w-3.5" />
            ${shift.hourly_rate}/hr
          </div>
        </div>
      )}

      {/* Note from admin */}
      {app.note && (
        <p className="text-xs text-gray-500 bg-gray-50 rounded px-3 py-2 italic">
          Note: {app.note}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1">
        <p className="text-xs text-gray-400">
          Applied {new Date(app.applied_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          {app.reviewed_at && ` · Reviewed ${new Date(app.reviewed_at).toLocaleDateString()}`}
        </p>
        {app.status === 'pending' && (
          <button
            onClick={() => onWithdraw(app.id)}
            disabled={withdrawing}
            className="text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
          >
            {withdrawing ? 'Withdrawing…' : 'Withdraw'}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const STATUS_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'pending' },
  { label: 'Accepted', value: 'accepted' },
  { label: 'Rejected', value: 'rejected' },
  { label: 'Withdrawn', value: 'withdrawn' },
]

export default function MyApplicationsPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  const [applications, setApplications] = useState<ShiftApplication[]>([])
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null)
  const [withdrawError, setWithdrawError] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && !user) router.push('/auth/signin')
  }, [user, loading, router])

  const fetchApplications = useCallback(async () => {
    setFetching(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      const res = await fetch(`/api/marketplace/my-applications?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setApplications(json.applications ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load applications')
    } finally {
      setFetching(false)
    }
  }, [statusFilter])

  useEffect(() => {
    if (user) fetchApplications()
  }, [user, fetchApplications])

  const handleWithdraw = async (applicationId: string) => {
    setWithdrawingId(applicationId)
    setWithdrawError(null)
    try {
      const res = await fetch(`/api/marketplace/my-applications?application_id=${applicationId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? 'Withdraw failed')
      }
      // Update local state
      setApplications(prev =>
        prev.map(a => a.id === applicationId ? { ...a, status: 'withdrawn' as AppStatus } : a)
      )
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : 'Failed to withdraw')
    } finally {
      setWithdrawingId(null)
    }
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/marketplace" className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">My Applications</h1>
            <p className="text-sm text-gray-500">Track the status of your shift applications</p>
          </div>
        </div>

        {/* Withdraw error */}
        {withdrawError && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
            {withdrawError}
          </div>
        )}

        {/* Status filter tabs */}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                statusFilter === f.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {fetching ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-5 animate-pulse">
                <div className="h-5 bg-gray-200 rounded w-1/2 mb-3" />
                <div className="h-4 bg-gray-100 rounded w-1/3 mb-3" />
                <div className="h-4 bg-gray-100 rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-6 text-center">
            <AlertCircle className="h-8 w-8 mx-auto mb-2" />
            <p>{error}</p>
            <button onClick={fetchApplications} className="mt-2 text-sm text-indigo-600 font-medium">
              Retry
            </button>
          </div>
        ) : applications.length === 0 ? (
          <div className="text-center py-20">
            <Briefcase className="h-12 w-12 mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-700">No applications yet</h3>
            <p className="text-sm text-gray-500 mt-2">
              {statusFilter
                ? 'No applications with this status.'
                : 'Browse the marketplace and apply to open shifts.'}
            </p>
            <Link
              href="/marketplace"
              className="mt-4 inline-block text-sm text-indigo-600 hover:text-indigo-700 font-medium"
            >
              Browse Shifts →
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">{applications.length} application{applications.length !== 1 ? 's' : ''}</p>
            {applications.map(app => (
              <ApplicationCard
                key={app.id}
                app={app}
                onWithdraw={handleWithdraw}
                withdrawing={withdrawingId === app.id}
              />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
