'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import {
  FileText,
  CheckCircle,
  ChevronLeft,
  RefreshCw,
  Clock,
  MessageSquare,
  AlertCircle,
} from 'lucide-react'

interface NurseRef {
  id: string
  full_name: string | null
}

interface CredentialRef {
  id: string
  type: string
  expiration_date: string
  status: string
}

interface RenewalTaskRow {
  id: string
  nurse_id: string
  credential_id: string
  facility_id: string | null
  status: string
  steps: Array<{ step: string; label: string; completed_at: string | null }>
  submitted_at: string | null
  verified_at: string | null
  notes: string | null
  created_at: string
  nurse: NurseRef | null
  credential: CredentialRef | null
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-gray-500/20 text-gray-400 border border-gray-500/30',
  in_progress: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  submitted: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  under_review: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  verified: 'bg-green-500/20 text-green-400 border border-green-500/30',
  expired_without_renewal: 'bg-red-500/20 text-red-400 border border-red-500/30',
}

function formatDate(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function RenewalsAdminPage() {
  const { user, loading, isHospital } = useAuth()
  const router = useRouter()

  const [tasks, setTasks] = useState<RenewalTaskRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [fetching, setFetching] = useState(true)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [notesModal, setNotesModal] = useState<{ id: string; notes: string } | null>(null)
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    if (!loading && !user) router.push('/auth/signin')
    if (!loading && user && !isHospital) router.push('/nurse')
  }, [user, loading, isHospital, router])

  const fetchTasks = useCallback(async () => {
    if (!user) return
    setFetching(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      if (statusFilter) params.set('status', statusFilter)

      const res = await fetch(`/api/credentials/renewal?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setTasks(data.tasks ?? [])
      setTotal(data.total ?? 0)
    } catch (err) {
      console.error('[Renewals] Fetch error:', err)
    } finally {
      setFetching(false)
    }
  }, [user, page, statusFilter])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  const handleVerify = async (taskId: string) => {
    setVerifying(taskId)
    try {
      const res = await fetch(`/api/credentials/renewal/${taskId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error('Verification failed')
      await fetchTasks()
    } catch (err) {
      console.error('[Renewals] Verify error:', err)
    } finally {
      setVerifying(null)
    }
  }

  const handleRequestMoreInfo = async () => {
    if (!notesModal) return
    try {
      // Stub: In production this would send a message/notification to the nurse
      await fetch(`/api/credentials/renewal/${notesModal.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notesModal.notes }),
      })
      setNotesModal(null)
      await fetchTasks()
    } catch (err) {
      console.error('[Renewals] Request more info error:', err)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ns-dark-950">
        <div className="animate-pulse text-ns-teal">Loading renewals...</div>
      </div>
    )
  }

  if (!user || !isHospital) return null

  const totalPages = Math.ceil(total / 25)

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-6">
          <Link
            href="/dashboard/credentials"
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Credentials
          </Link>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <FileText className="h-7 w-7 text-ns-teal" />
            <div>
              <h1 className="text-2xl font-bold text-white">Credential Renewals</h1>
              <p className="text-sm text-gray-400">
                Review and verify nurse credential renewal submissions
              </p>
            </div>
          </div>
          <button
            onClick={fetchTasks}
            disabled={fetching}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-ns-dark-700 bg-ns-dark-900 text-sm text-gray-300 hover:border-ns-teal/40 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${fetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Status Filter */}
        <div className="flex gap-3 mb-6">
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 rounded-lg border border-ns-dark-700 bg-ns-dark-900 text-sm text-gray-300 focus:outline-none focus:border-ns-teal/60"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="submitted">Submitted</option>
            <option value="under_review">Under Review</option>
            <option value="verified">Verified</option>
            <option value="expired_without_renewal">Expired Without Renewal</option>
          </select>
          {statusFilter && (
            <button
              onClick={() => { setStatusFilter(''); setPage(1) }}
              className="px-3 py-2 rounded-lg border border-ns-dark-700 bg-ns-dark-800 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Table */}
        <div className="rounded-xl border border-ns-dark-700 bg-ns-dark-900 overflow-hidden">
          {fetching ? (
            <div className="py-12 text-center text-gray-500">
              <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-3 text-gray-600" />
              Loading renewal tasks...
            </div>
          ) : tasks.length === 0 ? (
            <div className="py-16 text-center">
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3 opacity-60" />
              <p className="text-gray-400 font-medium">No renewal tasks found</p>
              <p className="text-gray-600 text-sm mt-1">
                Renewal tasks are created automatically when credentials expire
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ns-dark-700">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Nurse
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Credential Type
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Expiration
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Submitted
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Steps
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ns-dark-700">
                    {tasks.map((task) => {
                      const completedSteps = task.steps.filter((s) => s.completed_at).length
                      const totalSteps = task.steps.length
                      return (
                        <tr key={task.id} className="hover:bg-ns-dark-800/50 transition-colors">
                          <td className="px-4 py-3 text-white font-medium">
                            {task.nurse?.full_name ?? (
                              <span className="text-gray-600 italic">Unknown</span>
                            )}
                          </td>

                          <td className="px-4 py-3 text-gray-300">
                            {task.credential?.type ?? (
                              <span className="text-gray-600 italic">—</span>
                            )}
                          </td>

                          <td className="px-4 py-3 text-gray-300">
                            {formatDate(task.credential?.expiration_date ?? null)}
                          </td>

                          <td className="px-4 py-3 text-gray-400">
                            {task.submitted_at ? (
                              formatDate(task.submitted_at)
                            ) : (
                              <span className="text-gray-600 italic flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                Awaiting
                              </span>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[task.status] ?? ''}`}
                            >
                              {task.status.replace(/_/g, ' ')}
                            </span>
                          </td>

                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="flex gap-1">
                                {task.steps.map((step) => (
                                  <div
                                    key={step.step}
                                    title={step.label}
                                    className={`w-2 h-2 rounded-full ${
                                      step.completed_at
                                        ? 'bg-green-400'
                                        : 'bg-ns-dark-600'
                                    }`}
                                  />
                                ))}
                              </div>
                              <span className="text-xs text-gray-500">
                                {completedSteps}/{totalSteps}
                              </span>
                            </div>
                          </td>

                          <td className="px-4 py-3">
                            {task.status === 'submitted' || task.status === 'under_review' ? (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleVerify(task.id)}
                                  disabled={verifying === task.id}
                                  className="flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 disabled:opacity-50 transition-colors"
                                >
                                  <CheckCircle className="h-3 w-3" />
                                  Verify
                                </button>
                                <button
                                  onClick={() => setNotesModal({ id: task.id, notes: task.notes ?? '' })}
                                  className="flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 transition-colors"
                                >
                                  <MessageSquare className="h-3 w-3" />
                                  More Info
                                </button>
                              </div>
                            ) : task.status === 'verified' ? (
                              <span className="flex items-center gap-1 text-xs text-green-400">
                                <CheckCircle className="h-3 w-3" />
                                Verified {formatDate(task.verified_at)}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-600 italic">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-ns-dark-700">
                  <p className="text-xs text-gray-500">
                    Showing {((page - 1) * 25) + 1}–{Math.min(page * 25, total)} of {total} tasks
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

        {/* Request More Info Modal */}
        {notesModal && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-ns-dark-900 border border-ns-dark-700 rounded-xl p-6 w-full max-w-md">
              <div className="flex items-center gap-2 mb-4">
                <AlertCircle className="h-5 w-5 text-orange-400" />
                <h3 className="text-lg font-semibold text-white">Request More Information</h3>
              </div>
              <p className="text-sm text-gray-400 mb-4">
                Add a note explaining what additional information is needed from the nurse.
              </p>
              <textarea
                value={notesModal.notes}
                onChange={(e) => setNotesModal({ ...notesModal, notes: e.target.value })}
                placeholder="e.g. Please resubmit — document is illegible in the uploaded image."
                rows={4}
                className="w-full px-3 py-2 rounded-lg border border-ns-dark-700 bg-ns-dark-800 text-sm text-gray-300 placeholder:text-gray-600 focus:outline-none focus:border-ns-teal/60 resize-none"
              />
              <div className="flex justify-end gap-3 mt-4">
                <button
                  onClick={() => setNotesModal(null)}
                  className="px-4 py-2 rounded-lg border border-ns-dark-700 text-sm text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRequestMoreInfo}
                  disabled={!notesModal.notes.trim()}
                  className="px-4 py-2 rounded-lg bg-ns-teal text-black text-sm font-medium disabled:opacity-50 transition-opacity"
                >
                  Send Request
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
