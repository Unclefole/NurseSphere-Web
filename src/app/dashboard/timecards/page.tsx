'use client'

/**
 * /dashboard/timecards
 *
 * Facility admin timecard management:
 * - Table: shift date | nurse name | clock in | clock out | total hours | status badge
 * - Filter by status
 * - Approve / Dispute buttons per row
 * - Batch approve for selected timecards
 */

import { useState, useEffect, useCallback } from 'react'
import { DashboardLayout } from '@/components/layout'
import {
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  Filter,
  CheckSquare,
  Square,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type TimecardStatus = 'draft' | 'submitted' | 'approved' | 'disputed' | 'paid'

interface Timecard {
  id: string
  shift_id: string
  nurse_id: string
  facility_id: string
  clock_in_at: string | null
  clock_out_at: string | null
  break_minutes: number
  total_hours: number | null
  status: TimecardStatus
  submitted_at: string | null
  approved_at: string | null
  dispute_reason: string | null
  notes: string | null
  created_at: string
  shifts?: {
    start_time: string
    end_time: string
    department: string
    hourly_rate: number
  } | null
  nurse?: {
    full_name: string
  } | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function fmtHours(hours: number | null): string {
  if (hours == null) return '—'
  return `${Number(hours).toFixed(2)} hrs`
}

const STATUS_STYLES: Record<TimecardStatus, { label: string; className: string; icon: React.ReactNode }> = {
  draft: {
    label: 'Draft',
    className: 'bg-gray-100 text-gray-700',
    icon: <Clock size={12} />,
  },
  submitted: {
    label: 'Submitted',
    className: 'bg-blue-100 text-blue-700',
    icon: <Clock size={12} />,
  },
  approved: {
    label: 'Approved',
    className: 'bg-green-100 text-green-700',
    icon: <CheckCircle2 size={12} />,
  },
  disputed: {
    label: 'Disputed',
    className: 'bg-red-100 text-red-700',
    icon: <AlertCircle size={12} />,
  },
  paid: {
    label: 'Paid',
    className: 'bg-purple-100 text-purple-700',
    icon: <CheckCircle2 size={12} />,
  },
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TimecardsPage() {
  const [timecards, setTimecards] = useState<Timecard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<TimecardStatus | 'all'>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})
  const [batchLoading, setBatchLoading] = useState(false)
  const [disputeModal, setDisputeModal] = useState<{ id: string } | null>(null)
  const [disputeReason, setDisputeReason] = useState('')
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 4000)
  }

  const loadTimecards = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const res = await fetch(`/api/timecards?${params}`)
      if (!res.ok) throw new Error(`Failed to load timecards: ${res.status}`)
      const data = await res.json()
      setTimecards(data.timecards ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load timecards')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    loadTimecards()
  }, [loadTimecards])

  const approveTimecard = async (id: string) => {
    setActionLoading(prev => ({ ...prev, [id]: true }))
    try {
      const res = await fetch(`/api/timecards/${id}/approve`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Approval failed')
      }
      showToast('success', 'Timecard approved and payout initiated.')
      loadTimecards()
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Approval failed')
    } finally {
      setActionLoading(prev => ({ ...prev, [id]: false }))
    }
  }

  const openDisputeModal = (id: string) => {
    setDisputeModal({ id })
    setDisputeReason('')
  }

  const submitDispute = async () => {
    if (!disputeModal || !disputeReason.trim()) return
    const { id } = disputeModal
    setActionLoading(prev => ({ ...prev, [id]: true }))
    try {
      const res = await fetch(`/api/timecards/${id}/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: disputeReason }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Dispute failed')
      }
      showToast('success', 'Timecard marked as disputed.')
      setDisputeModal(null)
      loadTimecards()
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Dispute failed')
    } finally {
      setActionLoading(prev => ({ ...prev, [id]: false }))
    }
  }

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    const approvable = timecards
      .filter(t => t.status === 'submitted')
      .map(t => t.id)
    if (selected.size === approvable.length && approvable.length > 0) {
      setSelected(new Set())
    } else {
      setSelected(new Set(approvable))
    }
  }

  const batchApprove = async () => {
    if (selected.size === 0) return
    setBatchLoading(true)
    const ids = Array.from(selected)
    let successCount = 0
    let failCount = 0
    for (const id of ids) {
      try {
        const res = await fetch(`/api/timecards/${id}/approve`, { method: 'POST' })
        if (res.ok) successCount++
        else failCount++
      } catch {
        failCount++
      }
    }
    setBatchLoading(false)
    setSelected(new Set())
    showToast(
      failCount === 0 ? 'success' : 'error',
      `${successCount} approved${failCount > 0 ? `, ${failCount} failed` : ''}.`
    )
    loadTimecards()
  }

  const submittedTimecards = timecards.filter(t => t.status === 'submitted')
  const allSubmittedSelected =
    submittedTimecards.length > 0 &&
    submittedTimecards.every(t => selected.has(t.id))

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Timecards</h1>
            <p className="text-sm text-gray-500 mt-1">
              Review and approve nurse timecards for completed shifts.
            </p>
          </div>
          <button
            onClick={loadTimecards}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {/* Toast */}
        {toast && (
          <div
            className={`mb-4 p-4 rounded-lg text-sm font-medium flex items-center gap-2 ${
              toast.type === 'success'
                ? 'bg-green-50 text-green-800 border border-green-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            {toast.message}
          </div>
        )}

        {/* Filters + Batch Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-gray-500" />
            <span className="text-sm text-gray-600 font-medium">Status:</span>
            <div className="flex gap-1 flex-wrap">
              {(['all', 'submitted', 'approved', 'disputed', 'paid', 'draft'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => { setStatusFilter(s); setSelected(new Set()) }}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    statusFilter === s
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {s === 'all' ? 'All' : STATUS_STYLES[s]?.label ?? s}
                </button>
              ))}
            </div>
          </div>

          {selected.size > 0 && (
            <button
              onClick={batchApprove}
              disabled={batchLoading}
              className="ml-auto inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors"
            >
              {batchLoading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              Approve {selected.size} Selected
            </button>
          )}
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <Loader2 size={32} className="animate-spin" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-20 text-red-600">
            <AlertCircle size={32} />
            <p className="font-medium">{error}</p>
            <button onClick={loadTimecards} className="text-sm underline">Retry</button>
          </div>
        ) : timecards.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-20 text-gray-400">
            <Clock size={48} />
            <p className="font-medium text-gray-600">No timecards found</p>
            <p className="text-sm">
              {statusFilter !== 'all' ? `No ${statusFilter} timecards.` : 'Timecards will appear here when nurses clock in and out.'}
            </p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left">
                      <button onClick={toggleSelectAll} className="text-gray-400 hover:text-gray-600">
                        {allSubmittedSelected ? (
                          <CheckSquare size={16} className="text-blue-600" />
                        ) : (
                          <Square size={16} />
                        )}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Shift Date</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Nurse</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Clock In</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Clock Out</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Break</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Total Hours</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Status</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {timecards.map(tc => {
                    const statusStyle = STATUS_STYLES[tc.status]
                    const isLoading = actionLoading[tc.id]
                    const isSelected = selected.has(tc.id)
                    const canApprove = tc.status === 'submitted'
                    const canDispute = tc.status === 'submitted' || tc.status === 'draft'

                    return (
                      <tr
                        key={tc.id}
                        className={`hover:bg-gray-50 transition-colors ${isSelected ? 'bg-blue-50' : ''}`}
                      >
                        <td className="px-4 py-3">
                          {canApprove ? (
                            <button onClick={() => toggleSelect(tc.id)} className="text-gray-400 hover:text-gray-600">
                              {isSelected ? (
                                <CheckSquare size={16} className="text-blue-600" />
                              ) : (
                                <Square size={16} />
                              )}
                            </button>
                          ) : (
                            <span className="w-4 inline-block" />
                          )}
                        </td>

                        <td className="px-4 py-3 text-gray-900 whitespace-nowrap">
                          {tc.shifts?.start_time
                            ? new Date(tc.shifts.start_time).toLocaleDateString('en-US', {
                                weekday: 'short', month: 'short', day: 'numeric',
                              })
                            : '—'}
                          {tc.shifts?.department && (
                            <div className="text-xs text-gray-500">{tc.shifts.department}</div>
                          )}
                        </td>

                        <td className="px-4 py-3">
                          <span className="font-medium text-gray-900">
                            {tc.nurse?.full_name ?? '—'}
                          </span>
                        </td>

                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap font-mono text-xs">
                          {fmtDateTime(tc.clock_in_at)}
                        </td>

                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap font-mono text-xs">
                          {fmtDateTime(tc.clock_out_at)}
                        </td>

                        <td className="px-4 py-3 text-gray-700 text-center">
                          {tc.break_minutes > 0 ? `${tc.break_minutes}m` : '—'}
                        </td>

                        <td className="px-4 py-3 font-semibold text-gray-900">
                          {fmtHours(tc.total_hours)}
                        </td>

                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${statusStyle.className}`}
                          >
                            {statusStyle.icon}
                            {statusStyle.label}
                          </span>
                          {tc.dispute_reason && (
                            <div className="text-xs text-red-600 mt-1 max-w-[140px] truncate" title={tc.dispute_reason}>
                              {tc.dispute_reason}
                            </div>
                          )}
                        </td>

                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {canApprove && (
                              <button
                                onClick={() => approveTimecard(tc.id)}
                                disabled={isLoading}
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors"
                              >
                                {isLoading ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : (
                                  <CheckCircle2 size={12} />
                                )}
                                Approve
                              </button>
                            )}
                            {canDispute && (
                              <button
                                onClick={() => openDisputeModal(tc.id)}
                                disabled={isLoading}
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-60 transition-colors"
                              >
                                <XCircle size={12} />
                                Dispute
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Dispute Modal */}
        {disputeModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-2">Dispute Timecard</h2>
              <p className="text-sm text-gray-600 mb-4">
                Please provide a reason for disputing this timecard. The nurse will be notified.
              </p>
              <textarea
                value={disputeReason}
                onChange={e => setDisputeReason(e.target.value)}
                className="w-full border border-gray-200 rounded-lg p-3 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-red-300"
                rows={4}
                placeholder="Describe the discrepancy or issue..."
              />
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => setDisputeModal(null)}
                  className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={submitDispute}
                  disabled={!disputeReason.trim() || actionLoading[disputeModal.id]}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-60 transition-colors"
                >
                  {actionLoading[disputeModal.id] ? (
                    <Loader2 size={16} className="animate-spin mx-auto" />
                  ) : (
                    'Submit Dispute'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
