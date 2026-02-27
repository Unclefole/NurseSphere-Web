'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import { supabase } from '@/lib/supabase'
import {
  Shield,
  CheckCircle,
  Clock,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  FileText,
} from 'lucide-react'

interface CredentialRow {
  id: string
  user_id: string
  document_type: string
  document_name: string
  status: string
  issued_at: string | null
  expires_at: string | null
  verified_at: string | null
  verified_by: string | null
  created_at: string
  nurse_name?: string
  nurse_email?: string
}

const PAGE_SIZE = 25

const STATUS_BADGE: Record<
  string,
  { label: string; icon: React.ReactNode; className: string }
> = {
  valid: {
    label: 'Valid',
    icon: <CheckCircle className="h-3.5 w-3.5" />,
    className: 'bg-green-500/20 text-green-400 border border-green-500/30',
  },
  expiring_soon: {
    label: '🟡 Expiring Soon',
    icon: <Clock className="h-3.5 w-3.5" />,
    className: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  },
  expiring_critical: {
    label: '🔴 Expiring Critical',
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    className: 'bg-red-500/20 text-red-400 border border-red-500/30',
  },
  expired: {
    label: '⛔ Expired',
    icon: <XCircle className="h-3.5 w-3.5" />,
    className: 'bg-red-900/30 text-red-400 border border-red-700/40',
  },
  pending: {
    label: 'Pending',
    icon: <Clock className="h-3.5 w-3.5" />,
    className: 'bg-gray-600/30 text-gray-400 border border-gray-600/30',
  },
  expiring: {
    label: '🟡 Expiring',
    icon: <Clock className="h-3.5 w-3.5" />,
    className: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  },
}

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_BADGE[status] ?? {
    label: status,
    icon: null,
    className: 'bg-gray-600/30 text-gray-400',
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.className}`}
    >
      {config.icon}
      {config.label}
    </span>
  )
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function CredentialsDashboardPage() {
  const { user, loading, isHospital } = useAuth()
  const router = useRouter()

  const [credentials, setCredentials] = useState<CredentialRow[]>([])
  const [fetching, setFetching] = useState(true)
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  const fetchCredentials = useCallback(async () => {
    if (!user?.facilityId) return
    setFetching(true)

    try {
      // Fetch all nurse IDs who have contracts at this facility
      const { data: contracts } = await supabase
        .from('contracts')
        .select('nurse_id')
        .eq('facility_id', user.facilityId)

      const nurseIds = [...new Set((contracts ?? []).map((c) => c.nurse_id))]

      if (nurseIds.length === 0) {
        setCredentials([])
        setTotal(0)
        setFetching(false)
        return
      }

      let query = supabase
        .from('credentials')
        .select('*', { count: 'exact' })
        .in('user_id', nurseIds)
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }

      const { data, count, error } = await query

      if (error) throw error

      // Enrich with nurse profiles
      const userIds = [...new Set((data ?? []).map((c) => c.user_id))]
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds)

      const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]))

      const enriched: CredentialRow[] = (data ?? []).map((cred) => {
        const profile = profileMap.get(cred.user_id)
        return {
          ...cred,
          nurse_name: profile?.full_name ?? 'Unknown Nurse',
        }
      })

      // Apply search client-side after enrichment
      const filtered = search
        ? enriched.filter(
            (c) =>
              c.nurse_name?.toLowerCase().includes(search.toLowerCase()) ||
              c.document_type.toLowerCase().includes(search.toLowerCase()) ||
              c.document_name.toLowerCase().includes(search.toLowerCase())
          )
        : enriched

      setCredentials(filtered)
      setTotal(count ?? 0)
    } catch (err) {
      console.error('[CredentialsDashboard] Fetch error:', err)
    } finally {
      setFetching(false)
    }
  }, [user, page, statusFilter, search])

  useEffect(() => {
    if (!loading && !user) router.push('/auth/signin')
    if (!loading && user && !isHospital) router.push('/nurse')
  }, [user, loading, isHospital, router])

  useEffect(() => {
    if (user) fetchCredentials()
  }, [user, fetchCredentials])

  const handleVerify = async (credentialId: string, documentType: string, documentName: string) => {
    setVerifyingId(credentialId)
    try {
      const resp = await fetch('/api/credentials/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId, facilityId: user?.facilityId }),
      })

      if (!resp.ok) {
        const err = await resp.json()
        throw new Error(err.error ?? 'Verification failed')
      }

      showToast(`✅ ${documentName} (${documentType}) verified successfully`, 'success')
      await fetchCredentials()
    } catch (err) {
      showToast(`❌ ${err instanceof Error ? err.message : 'Verification failed'}`, 'error')
    } finally {
      setVerifyingId(null)
    }
  }

  if (loading || fetching) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ns-dark-950">
        <div className="animate-pulse text-ns-teal">Loading credentials...</div>
      </div>
    )
  }

  if (!user || !isHospital) return null

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-8">
        {/* Toast */}
        {toast && (
          <div
            className={`fixed top-4 right-4 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all ${
              toast.type === 'success'
                ? 'bg-green-600 text-white'
                : 'bg-red-600 text-white'
            }`}
          >
            {toast.message}
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Shield className="h-6 w-6 text-ns-teal" />
            <div>
              <h1 className="text-2xl font-bold text-white">Credential Verification</h1>
              <p className="text-sm text-gray-400">
                Review and manually verify nurse credentials for your facility
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/credentials/renewals"
              className="flex items-center gap-2 rounded-lg border border-ns-teal/30 bg-ns-teal/10 px-3 py-2 text-sm text-ns-teal hover:border-ns-teal/60 transition-colors"
            >
              <FileText className="h-4 w-4" />
              Renewal Tasks
            </Link>
            <button
              onClick={fetchCredentials}
              className="flex items-center gap-2 rounded-lg border border-ns-dark-600 bg-ns-dark-800 px-3 py-2 text-sm text-gray-300 hover:text-white transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search by nurse name, document type..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0) }}
              className="w-full rounded-lg border border-ns-dark-600 bg-ns-dark-800 pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:border-ns-teal focus:outline-none"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0) }}
            className="rounded-lg border border-ns-dark-600 bg-ns-dark-800 px-3 py-2 text-sm text-white focus:border-ns-teal focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="valid">Valid</option>
            <option value="expiring_soon">Expiring Soon</option>
            <option value="expiring_critical">Expiring Critical</option>
            <option value="expired">Expired</option>
          </select>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-ns-dark-700 bg-ns-dark-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ns-dark-700 bg-ns-dark-800/50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Nurse
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Document
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Issued
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Expires
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Verified At
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ns-dark-700">
                {credentials.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                      No credentials found
                    </td>
                  </tr>
                ) : (
                  credentials.map((cred) => (
                    <tr
                      key={cred.id}
                      className="hover:bg-ns-dark-800/40 transition-colors"
                    >
                      <td className="px-4 py-3 text-white font-medium">
                        {cred.nurse_name}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-white">{cred.document_name}</div>
                        <div className="text-xs text-gray-500">{cred.document_type}</div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={cred.status} />
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {formatDate(cred.issued_at)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            cred.status === 'expired' || cred.status === 'expiring_critical'
                              ? 'text-red-400'
                              : cred.status === 'expiring_soon' || cred.status === 'expiring'
                              ? 'text-yellow-400'
                              : 'text-gray-400'
                          }
                        >
                          {formatDate(cred.expires_at)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {cred.verified_at ? (
                          <span className="text-green-400 text-xs">
                            ✓ {formatDate(cred.verified_at)}
                          </span>
                        ) : (
                          <span className="text-gray-600 text-xs">Not verified</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {!cred.verified_at ? (
                          <button
                            onClick={() =>
                              handleVerify(cred.id, cred.document_type, cred.document_name)
                            }
                            disabled={verifyingId === cred.id}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-ns-teal/20 border border-ns-teal/30 px-3 py-1.5 text-xs font-medium text-ns-teal hover:bg-ns-teal/30 transition-colors disabled:opacity-50"
                          >
                            {verifyingId === cred.id ? (
                              <>
                                <RefreshCw className="h-3 w-3 animate-spin" />
                                Verifying…
                              </>
                            ) : (
                              <>
                                <CheckCircle className="h-3 w-3" />
                                Verify
                              </>
                            )}
                          </button>
                        ) : (
                          <button
                            onClick={() =>
                              handleVerify(cred.id, cred.document_type, cred.document_name)
                            }
                            disabled={verifyingId === cred.id}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-ns-dark-600 px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white hover:border-gray-400 transition-colors disabled:opacity-50"
                          >
                            Re-verify
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-ns-dark-700 px-4 py-3">
              <span className="text-xs text-gray-500">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="rounded-lg border border-ns-dark-600 p-1.5 text-gray-400 hover:text-white disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs text-gray-400">
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="rounded-lg border border-ns-dark-600 p-1.5 text-gray-400 hover:text-white disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
