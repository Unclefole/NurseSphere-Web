'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import { supabase } from '@/lib/supabase'
import {
  ClipboardList,
  Search,
  Download,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react'

interface AuditLogRow {
  id: string
  user_id: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  user_name?: string
}

const PAGE_SIZE = 50

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function getIpFromMetadata(metadata: Record<string, unknown> | null): string {
  if (!metadata) return '—'
  return (metadata.ipAddress as string) ?? (metadata.ip_address as string) ?? '—'
}

function getResultFromMetadata(metadata: Record<string, unknown> | null): string {
  if (!metadata) return '—'
  if (metadata.error) return '❌ Error'
  return '✅ Success'
}

export default function AuditLogPage() {
  const { user, loading, isHospital } = useAuth()
  const router = useRouter()

  const [logs, setLogs] = useState<AuditLogRow[]>([])
  const [fetching, setFetching] = useState(true)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  })
  const [toDate, setToDate] = useState(() => new Date().toISOString().split('T')[0])
  const [exporting, setExporting] = useState(false)

  const fetchLogs = useCallback(async () => {
    if (!user) return
    setFetching(true)

    try {
      const from = new Date(fromDate + 'T00:00:00Z').toISOString()
      const to = new Date(toDate + 'T23:59:59Z').toISOString()

      let query = supabase
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .gte('created_at', from)
        .lte('created_at', to)
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      // Apply search filter via action or resource_type
      if (search) {
        query = query.or(`action.ilike.%${search}%,resource_type.ilike.%${search}%`)
      }

      const { data, count, error } = await query

      if (error) throw error

      // Enrich with user profiles
      const userIds = [...new Set((data ?? []).filter((l) => l.user_id).map((l) => l.user_id!))]
      let profileMap = new Map<string, string>()

      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', userIds)
        profileMap = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.id]))
      }

      const enriched: AuditLogRow[] = (data ?? []).map((log) => ({
        ...log,
        metadata: log.metadata as Record<string, unknown> | null,
        user_name: log.user_id ? (profileMap.get(log.user_id) ?? log.user_id) : 'System',
      }))

      setLogs(enriched)
      setTotal(count ?? 0)
    } catch (err) {
      console.error('[AuditLog] Fetch error:', err)
    } finally {
      setFetching(false)
    }
  }, [user, page, search, fromDate, toDate])

  useEffect(() => {
    if (!loading && !user) router.push('/auth/signin')
    if (!loading && user && !isHospital) router.push('/nurse')
  }, [user, loading, isHospital, router])

  useEffect(() => {
    if (user) fetchLogs()
  }, [user, fetchLogs])

  const handleExportCsv = async () => {
    setExporting(true)
    try {
      const url = `/api/audit/export?from=${fromDate}&to=${toDate}`
      const response = await fetch(url)
      if (!response.ok) throw new Error('Export failed')

      const blob = await response.blob()
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = `nursesphere-audit-${fromDate}-to-${toDate}.csv`
      a.click()
      URL.revokeObjectURL(href)
    } catch (err) {
      console.error('[AuditLog] Export error:', err)
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ns-dark-950">
        <div className="animate-pulse text-ns-teal">Loading audit log...</div>
      </div>
    )
  }

  if (!user || !isHospital) return null

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <ClipboardList className="h-6 w-6 text-ns-teal" />
            <div>
              <h1 className="text-2xl font-bold text-white">Audit Log</h1>
              <p className="text-sm text-gray-400">
                HIPAA-compliant record of all system activity
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchLogs}
              disabled={fetching}
              className="flex items-center gap-2 rounded-lg border border-ns-dark-600 bg-ns-dark-800 px-3 py-2 text-sm text-gray-300 hover:text-white transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${fetching ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={handleExportCsv}
              disabled={exporting}
              className="flex items-center gap-2 rounded-lg bg-ns-teal/20 border border-ns-teal/30 px-3 py-2 text-sm font-medium text-ns-teal hover:bg-ns-teal/30 transition-colors disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search by action or resource type..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0) }}
              className="w-full rounded-lg border border-ns-dark-600 bg-ns-dark-800 pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:border-ns-teal focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 whitespace-nowrap">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => { setFromDate(e.target.value); setPage(0) }}
              className="rounded-lg border border-ns-dark-600 bg-ns-dark-800 px-3 py-2 text-sm text-white focus:border-ns-teal focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 whitespace-nowrap">To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => { setToDate(e.target.value); setPage(0) }}
              className="rounded-lg border border-ns-dark-600 bg-ns-dark-800 px-3 py-2 text-sm text-white focus:border-ns-teal focus:outline-none"
            />
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-ns-dark-700 bg-ns-dark-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ns-dark-700 bg-ns-dark-800/50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Timestamp
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Action
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Resource
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    IP Address
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Result
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ns-dark-700">
                {fetching ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                      <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2" />
                      Loading...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                      No audit log entries found
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="hover:bg-ns-dark-800/40 transition-colors">
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">
                        {formatTimestamp(log.created_at)}
                      </td>
                      <td className="px-4 py-3 text-white text-xs whitespace-nowrap">
                        {log.user_name}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-ns-teal bg-ns-teal/10 rounded px-1.5 py-0.5">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {log.resource_type && (
                          <span>
                            {log.resource_type}
                            {log.resource_id && (
                              <span className="text-gray-600 ml-1">
                                #{log.resource_id.slice(0, 8)}
                              </span>
                            )}
                          </span>
                        )}
                        {!log.resource_type && '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs font-mono">
                        {getIpFromMetadata(log.metadata)}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {getResultFromMetadata(log.metadata)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between border-t border-ns-dark-700 px-4 py-3">
            <span className="text-xs text-gray-500">
              {total > 0
                ? `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total.toLocaleString()} entries`
                : '0 entries'}
            </span>
            {totalPages > 1 && (
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
            )}
          </div>
        </div>

        {/* Notice */}
        <p className="mt-4 text-xs text-gray-600 text-center">
          Audit logs are retained per HIPAA requirements. IP addresses are logged for compliance purposes.
          All exported files are sanitized of PHI before download.
        </p>
      </div>
    </DashboardLayout>
  )
}
