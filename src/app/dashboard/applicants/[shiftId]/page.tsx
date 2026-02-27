'use client'

/**
 * Admin: Shift Applicants
 * /dashboard/applicants/[shiftId]
 *
 * Lists nurses who applied to a specific shift.
 * Admin can Accept or Reject applications.
 * Accepted nurse is highlighted.
 * Compliance score badge per nurse.
 */

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import {
  ArrowLeft,
  Users,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  AlertCircle,
  Shield,
} from 'lucide-react'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

type AppStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'expired'

interface Applicant {
  id: string
  nurse_id: string
  nurse_name: string
  compliance_score: number | null
  status: AppStatus
  applied_at: string
  reviewed_at: string | null
  note: string | null
}

// ─── Compliance Score Badge ───────────────────────────────────────────────────

function ComplianceBadge({ score }: { score: number | null }) {
  if (score === null) {
    return <span className="text-xs text-gray-400">N/A</span>
  }
  const color =
    score >= 80 ? 'bg-green-100 text-green-700' :
    score >= 60 ? 'bg-yellow-100 text-yellow-700' :
                  'bg-red-100 text-red-700'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>
      <Shield className="h-3 w-3" />
      {Math.round(score)}
    </span>
  )
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AppStatus }) {
  const map: Record<AppStatus, { label: string; className: string }> = {
    pending:   { label: 'Pending',   className: 'bg-yellow-100 text-yellow-800' },
    accepted:  { label: 'Accepted',  className: 'bg-green-100 text-green-800' },
    rejected:  { label: 'Rejected',  className: 'bg-red-100 text-red-800' },
    withdrawn: { label: 'Withdrawn', className: 'bg-gray-100 text-gray-600' },
    expired:   { label: 'Expired',   className: 'bg-gray-100 text-gray-500' },
  }
  const cfg = map[status]
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.className}`}>
      {cfg.label}
    </span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ShiftApplicantsPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const shiftId = params.shiftId as string

  const [applicants, setApplicants] = useState<Applicant[]>([])
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionState, setActionState] = useState<{ id: string; action: 'accept' | 'reject' } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && !user) router.push('/auth/signin')
  }, [user, loading, router])

  const fetchApplicants = useCallback(async () => {
    setFetching(true)
    setError(null)
    try {
      const res = await fetch(`/api/marketplace/applications/${shiftId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setApplicants(json.applications ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load applicants')
    } finally {
      setFetching(false)
    }
  }, [shiftId])

  useEffect(() => {
    if (user) fetchApplicants()
  }, [user, fetchApplicants])

  const handleDecision = async (applicationId: string, decision: 'accept' | 'reject') => {
    setActionState({ id: applicationId, action: decision })
    setActionError(null)
    setActionSuccess(null)
    try {
      const res = await fetch(`/api/marketplace/applications/${shiftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ application_id: applicationId, decision }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `${decision} failed`)
      setActionSuccess(json.message ?? `Application ${decision}ed`)
      await fetchApplicants()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActionState(null)
    }
  }

  const isShiftFilled = applicants.some(a => a.status === 'accepted')

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
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Shift Applicants</h1>
            <p className="text-sm text-gray-500">Shift ID: {shiftId}</p>
          </div>
          {isShiftFilled && (
            <span className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-semibold">
              <CheckCircle className="h-4 w-4" />
              Shift Filled
            </span>
          )}
        </div>

        {/* Banners */}
        {actionError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {actionError}
          </div>
        )}
        {actionSuccess && (
          <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm flex items-center gap-2">
            <CheckCircle className="h-4 w-4 shrink-0" />
            {actionSuccess}
          </div>
        )}

        {/* Content */}
        {fetching ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-6 text-center">
            <AlertCircle className="h-8 w-8 mx-auto mb-2" />
            <p>{error}</p>
            <button onClick={fetchApplicants} className="mt-2 text-sm text-indigo-600 font-medium">
              Retry
            </button>
          </div>
        ) : applicants.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
            <Users className="h-12 w-12 mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-700">No applicants yet</h3>
            <p className="text-sm text-gray-500 mt-1">
              Nurses who apply from the marketplace will appear here.
            </p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <Users className="h-5 w-5 text-gray-400" />
              <span className="font-semibold text-gray-900">
                {applicants.length} {applicants.length === 1 ? 'Applicant' : 'Applicants'}
              </span>
            </div>
            <div className="divide-y divide-gray-100">
              {applicants.map(app => {
                const isAccepted = app.status === 'accepted'
                const isPending = app.status === 'pending'
                const isActing = actionState?.id === app.id

                return (
                  <div
                    key={app.id}
                    className={`px-5 py-4 flex items-center gap-4 ${isAccepted ? 'bg-green-50' : ''}`}
                  >
                    {/* Avatar placeholder */}
                    <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                      <span className="text-indigo-700 font-semibold text-sm">
                        {app.nurse_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </span>
                    </div>

                    {/* Nurse info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900">{app.nurse_name}</span>
                        {isAccepted && (
                          <span className="text-green-700 font-semibold text-xs flex items-center gap-1">
                            <CheckCircle className="h-3.5 w-3.5" />
                            Selected
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Applied {new Date(app.applied_at).toLocaleDateString()}
                        </span>
                        <ComplianceBadge score={app.compliance_score} />
                      </div>
                      {app.note && (
                        <p className="text-xs text-gray-500 italic mt-1">Note: {app.note}</p>
                      )}
                    </div>

                    {/* Status + Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={app.status} />
                      {isPending && !isShiftFilled && (
                        <>
                          <button
                            onClick={() => handleDecision(app.id, 'accept')}
                            disabled={isActing}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50"
                          >
                            {isActing && actionState?.action === 'accept' ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle className="h-3.5 w-3.5" />
                            )}
                            Accept
                          </button>
                          <button
                            onClick={() => handleDecision(app.id, 'reject')}
                            disabled={isActing}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 disabled:opacity-50"
                          >
                            {isActing && actionState?.action === 'reject' ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5" />
                            )}
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
