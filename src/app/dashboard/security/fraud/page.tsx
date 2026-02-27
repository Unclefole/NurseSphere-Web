'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import {
  ShieldAlert,
  ChevronLeft,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Info,
  RefreshCw,
} from 'lucide-react'

interface NurseRef {
  id: string
  full_name: string | null
}

interface FacilityRef {
  id: string
  name: string
}

interface SuspiciousEventRow {
  id: string
  event_type: string
  severity: string
  status: string
  nurse: NurseRef | null
  facility: FacilityRef | null
  evidence: Record<string, unknown>
  created_at: string
  resolved_at: string | null
}

const SEVERITY_BADGE: Record<string, string> = {
  low: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  high: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  critical: 'bg-red-500/20 text-red-400 border border-red-500/30',
}

const STATUS_BADGE: Record<string, string> = {
  open: 'bg-red-500/20 text-red-400 border border-red-500/30',
  investigating: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  closed: 'bg-green-500/20 text-green-400 border border-green-500/30',
  false_positive: 'bg-gray-500/20 text-gray-400 border border-gray-500/30',
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  duplicate_account: 'Duplicate Account',
  ip_anomaly: 'IP Anomaly',
  rapid_cancellations: 'Rapid Cancellations',
  payment_anomaly: 'Payment Anomaly',
  credential_mismatch: 'Credential Mismatch',
  login_burst: 'Login Burst',
}

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function FraudEventsPage() {
  const { user, loading, isHospital } = useAuth()
  const router = useRouter()

  const [events, setEvents] = useState<SuspiciousEventRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [fetching, setFetching] = useState(true)
  const [resolving, setResolving] = useState<string | null>(null)

  // Filters
  const [statusFilter, setStatusFilter] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const [fromFilter, setFromFilter] = useState('')
  const [toFilter, setToFilter] = useState('')

  useEffect(() => {
    if (!loading && !user) router.push('/auth/signin')
    if (!loading && user && !isHospital) router.push('/nurse')
  }, [user, loading, isHospital, router])

  const fetchEvents = useCallback(async () => {
    if (!user) return
    setFetching(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      if (statusFilter) params.set('status', statusFilter)
      if (severityFilter) params.set('severity', severityFilter)
      if (fromFilter) params.set('from', fromFilter)
      if (toFilter) params.set('to', toFilter)

      const res = await fetch(`/api/fraud/events?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setEvents(data.events ?? [])
      setTotal(data.total ?? 0)
    } catch (err) {
      console.error('[FraudEvents] Fetch error:', err)
    } finally {
      setFetching(false)
    }
  }, [user, page, statusFilter, severityFilter, fromFilter, toFilter])

  useEffect(() => {
    fetchEvents()
  }, [fetchEvents])

  const handleResolve = async (id: string, newStatus: 'closed' | 'false_positive') => {
    setResolving(id)
    try {
      const res = await fetch('/api/fraud/events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          status: newStatus,
          action_taken: newStatus === 'false_positive' ? 'marked_false_positive' : 'resolved_by_admin',
        }),
      })
      if (!res.ok) throw new Error('Failed to update')
      await fetchEvents()
    } catch (err) {
      console.error('[FraudEvents] Resolve error:', err)
    } finally {
      setResolving(null)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ns-dark-950">
        <div className="animate-pulse text-ns-teal">Loading fraud events...</div>
      </div>
    )
  }

  if (!user || !isHospital) return null

  const totalPages = Math.ceil(total / 25)

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link
            href="/dashboard/security"
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Security
          </Link>
        </div>

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-7 w-7 text-red-400" />
            <div>
              <h1 className="text-2xl font-bold text-white">Fraud & Identity Events</h1>
              <p className="text-sm text-gray-400">
                Suspicious activity detected by the Fraud Shield engine
              </p>
            </div>
          </div>
          <button
            onClick={fetchEvents}
            disabled={fetching}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-ns-dark-700 bg-ns-dark-900 text-sm text-gray-300 hover:border-ns-teal/40 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${fetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 rounded-lg border border-ns-dark-700 bg-ns-dark-900 text-sm text-gray-300 focus:outline-none focus:border-ns-teal/60"
          >
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="investigating">Investigating</option>
            <option value="closed">Closed</option>
            <option value="false_positive">False Positive</option>
          </select>

          <select
            value={severityFilter}
            onChange={(e) => { setSeverityFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 rounded-lg border border-ns-dark-700 bg-ns-dark-900 text-sm text-gray-300 focus:outline-none focus:border-ns-teal/60"
          >
            <option value="">All Severities</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>

          <input
            type="date"
            value={fromFilter}
            onChange={(e) => { setFromFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 rounded-lg border border-ns-dark-700 bg-ns-dark-900 text-sm text-gray-300 focus:outline-none focus:border-ns-teal/60"
            placeholder="From date"
          />

          <input
            type="date"
            value={toFilter}
            onChange={(e) => { setToFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 rounded-lg border border-ns-dark-700 bg-ns-dark-900 text-sm text-gray-300 focus:outline-none focus:border-ns-teal/60"
            placeholder="To date"
          />

          {(statusFilter || severityFilter || fromFilter || toFilter) && (
            <button
              onClick={() => { setStatusFilter(''); setSeverityFilter(''); setFromFilter(''); setToFilter(''); setPage(1) }}
              className="px-3 py-2 rounded-lg border border-ns-dark-700 bg-ns-dark-800 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Clear Filters
            </button>
          )}
        </div>

        {/* Table */}
        <div className="rounded-xl border border-ns-dark-700 bg-ns-dark-900 overflow-hidden">
          {fetching ? (
            <div className="py-12 text-center text-gray-500">
              <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-3 text-gray-600" />
              Loading events...
            </div>
          ) : events.length === 0 ? (
            <div className="py-16 text-center">
              <ShieldAlert className="h-12 w-12 text-green-500 mx-auto mb-3 opacity-60" />
              <p className="text-gray-400 font-medium">No suspicious activity detected</p>
              <p className="text-gray-600 text-sm mt-1">
                The Fraud Shield engine is monitoring for threats
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ns-dark-700">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Event Type
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Severity
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Nurse
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Facility
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Detected
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ns-dark-700">
                    {events.map((event) => (
                      <tr key={event.id} className="hover:bg-ns-dark-800/50 transition-colors">
                        <td className="px-4 py-3">
                          <span className="font-medium text-white">
                            {EVENT_TYPE_LABELS[event.event_type] ?? event.event_type}
                          </span>
                        </td>

                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${SEVERITY_BADGE[event.severity] ?? ''}`}
                          >
                            {event.severity}
                          </span>
                        </td>

                        <td className="px-4 py-3 text-gray-300">
                          {event.nurse?.full_name ?? (
                            <span className="text-gray-600 italic">Unknown</span>
                          )}
                        </td>

                        <td className="px-4 py-3 text-gray-300">
                          {event.facility?.name ?? (
                            <span className="text-gray-600 italic">—</span>
                          )}
                        </td>

                        <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                          {formatTimestamp(event.created_at)}
                        </td>

                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[event.status] ?? ''}`}
                          >
                            {event.status === 'false_positive'
                              ? 'False Positive'
                              : event.status}
                          </span>
                        </td>

                        <td className="px-4 py-3">
                          {event.status === 'open' || event.status === 'investigating' ? (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleResolve(event.id, 'closed')}
                                disabled={resolving === event.id}
                                className="flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 disabled:opacity-50 transition-colors"
                              >
                                <CheckCircle className="h-3 w-3" />
                                Resolve
                              </button>
                              <button
                                onClick={() => handleResolve(event.id, 'false_positive')}
                                disabled={resolving === event.id}
                                className="flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-gray-500/20 text-gray-400 border border-gray-500/30 hover:bg-gray-500/30 disabled:opacity-50 transition-colors"
                              >
                                <XCircle className="h-3 w-3" />
                                False Positive
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-600 italic">
                              {event.resolved_at
                                ? formatTimestamp(event.resolved_at)
                                : 'Resolved'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-ns-dark-700">
                  <p className="text-xs text-gray-500">
                    Showing {((page - 1) * 25) + 1}–{Math.min(page * 25, total)} of {total} events
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="px-3 py-1 rounded border border-ns-dark-700 text-sm text-gray-400 hover:border-ns-teal/40 disabled:opacity-40 transition-colors"
                    >
                      Previous
                    </button>
                    <span className="text-sm text-gray-400">
                      {page} / {totalPages}
                    </span>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="px-3 py-1 rounded border border-ns-dark-700 text-sm text-gray-400 hover:border-ns-teal/40 disabled:opacity-40 transition-colors"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Info note */}
        <div className="mt-6 rounded-xl border border-ns-dark-700 bg-ns-dark-800/50 px-5 py-4 flex items-start gap-3">
          <Info className="h-4 w-4 text-gray-500 mt-0.5 shrink-0" />
          <p className="text-xs text-gray-500">
            Fraud events are automatically generated by the Fraud Shield detection engine on login,
            registration, and scheduled checks. Resolving an event creates an audit log entry for
            compliance purposes. False positive events are retained for 90 days per data retention policy.
          </p>
        </div>
      </div>
    </DashboardLayout>
  )
}
