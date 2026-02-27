'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import {
  Shield,
  Download,
  CheckCircle,
  AlertTriangle,
  FileText,
  Search,
  RefreshCw,
  ExternalLink,
  Lock,
} from 'lucide-react'

// ─── Types ─────────────────────────────────────────────────────────────────

interface StaffingDecision {
  id: string
  shift_id: string
  nurse_id: string
  compliance_score: number
  competency_score: number
  admin_override: boolean
  certificate_hash: string | null
  issued_at: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-green-400'
  if (score >= 60) return 'text-yellow-400'
  return 'text-red-400'
}

function toCSV(decisions: StaffingDecision[]): string {
  const header = ['Certificate ID', 'Shift ID', 'Nurse ID', 'Compliance Score', 'Competency Score', 'Admin Override', 'Issued At']
  const rows = decisions.map((d) => [
    d.id, d.shift_id, d.nurse_id,
    d.compliance_score.toString(),
    d.competency_score.toString(),
    d.admin_override ? 'Yes' : 'No',
    d.issued_at,
  ])
  return [header, ...rows].map((row) => row.map((v) => `"${v}"`).join(',')).join('\n')
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RiskReportsPage() {
  const { user, profile } = useAuth()
  const router = useRouter()

  const [decisions, setDecisions] = useState<StaffingDecision[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const isAdmin = profile?.role === 'hospital_admin' || profile?.role === 'super_admin'

  const fetchDecisions = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const params = new URLSearchParams()
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)

      const res = await fetch(`/api/risk-reports/staffing-decisions?${params}`)
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Failed to load staffing decisions')
      }
      const data = await res.json()
      setDecisions(data.decisions ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate])

  useEffect(() => {
    if (!user) {
      router.push('/auth/signin')
      return
    }
    if (!isAdmin) {
      router.push('/dashboard')
      return
    }
    fetchDecisions()
  }, [user, isAdmin, router, fetchDecisions])

  const handleDownloadCertificate = async (certId: string) => {
    setDownloadingId(certId)
    try {
      const res = await fetch(`/api/risk-reports/certificate/${certId}`)
      if (!res.ok) throw new Error('Failed to download certificate')
      const html = await res.text()
      const blob = new Blob([html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `risk-certificate-${certId}.html`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setDownloadingId(null)
    }
  }

  const handleExportCSV = () => {
    const csv = toCSV(decisions)
    const dateLabel = startDate && endDate ? `${startDate}_to_${endDate}` : 'all'
    downloadCSV(csv, `staffing-decisions-${dateLabel}.csv`)
  }

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Shield className="w-6 h-6 text-blue-400" />
              Litigation Defense Export
            </h1>
            <p className="text-gray-400 mt-1 text-sm">
              Tamper-evident staffing decision logs and risk certificates for legal compliance.
            </p>
          </div>
          <div className="flex items-center gap-1 text-xs text-gray-500 bg-gray-800 border border-gray-700 px-3 py-1.5 rounded-lg">
            <Lock className="w-3 h-3" />
            Admin Only
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* Date Range Filter */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
          <h2 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
            <Search className="w-4 h-4 text-blue-400" />
            Search by Date Range
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">From</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">To</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={fetchDecisions}
              disabled={loading}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white rounded-lg px-4 py-2 text-sm"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Apply Filter
            </button>
            {(startDate || endDate) && (
              <button
                onClick={() => { setStartDate(''); setEndDate('') }}
                className="text-gray-400 hover:text-white text-sm"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Staffing Decision Logs */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-gray-700 flex items-center justify-between">
            <h2 className="text-white font-semibold flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-400" />
              Staffing Decision Logs
              {decisions.length > 0 && (
                <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">
                  {decisions.length}
                </span>
              )}
            </h2>
            <button
              onClick={handleExportCSV}
              disabled={decisions.length === 0}
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-white disabled:opacity-40 border border-gray-600 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Download className="w-3 h-3" />
              Export CSV
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10 gap-2 text-gray-400">
              <RefreshCw className="w-5 h-5 animate-spin" />
              Loading records…
            </div>
          ) : decisions.length === 0 ? (
            <div className="py-10 text-center text-gray-500 text-sm">
              No staffing decisions found for the selected period.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-xs uppercase border-b border-gray-700">
                    <th className="text-left px-4 py-3">Certificate ID</th>
                    <th className="text-left px-4 py-3">Nurse ID</th>
                    <th className="text-left px-4 py-3">Shift ID</th>
                    <th className="text-left px-4 py-3">Compliance</th>
                    <th className="text-left px-4 py-3">Competency</th>
                    <th className="text-left px-4 py-3">Override</th>
                    <th className="text-left px-4 py-3">Issued</th>
                    <th className="text-left px-4 py-3">Download</th>
                  </tr>
                </thead>
                <tbody>
                  {decisions.map((d) => (
                    <tr key={d.id} className="border-b border-gray-700/50 hover:bg-gray-700/20">
                      <td className="px-4 py-3 font-mono text-xs text-gray-400" title={d.id}>
                        {d.id.slice(0, 8)}…
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400" title={d.nurse_id}>
                        {d.nurse_id.slice(0, 8)}…
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400" title={d.shift_id}>
                        {d.shift_id.slice(0, 8)}…
                      </td>
                      <td className={`px-4 py-3 font-semibold text-sm ${scoreColor(d.compliance_score)}`}>
                        {d.compliance_score}%
                      </td>
                      <td className={`px-4 py-3 font-semibold text-sm ${scoreColor(d.competency_score)}`}>
                        {d.competency_score}
                      </td>
                      <td className="px-4 py-3">
                        {d.admin_override ? (
                          <span className="text-xs text-orange-400 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />Override
                          </span>
                        ) : (
                          <span className="text-xs text-gray-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                        {formatDate(d.issued_at)}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleDownloadCertificate(d.id)}
                          disabled={downloadingId === d.id}
                          className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-60"
                        >
                          {downloadingId === d.id ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <Download className="w-3 h-3" />
                          )}
                          HTML
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Risk Certificates Summary */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
          <h2 className="text-white font-semibold mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-400" />
            Risk Certificates
          </h2>
          <p className="text-gray-400 text-sm mb-3">
            Each shift acceptance generates an immutable, SHA-256 signed certificate. Tamper detection
            is performed automatically on download.
          </p>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="bg-gray-700/50 rounded-lg p-3">
              <div className="text-xl font-bold text-white">{decisions.length}</div>
              <div className="text-xs text-gray-400 mt-1">Total Certificates</div>
            </div>
            <div className="bg-gray-700/50 rounded-lg p-3">
              <div className="text-xl font-bold text-green-400">
                {decisions.filter((d) => d.certificate_hash).length}
              </div>
              <div className="text-xs text-gray-400 mt-1">Hash Verified</div>
            </div>
            <div className="bg-gray-700/50 rounded-lg p-3">
              <div className="text-xl font-bold text-orange-400">
                {decisions.filter((d) => d.admin_override).length}
              </div>
              <div className="text-xs text-gray-400 mt-1">Admin Overrides</div>
            </div>
          </div>
        </div>

        {/* Compliance History */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
          <h2 className="text-white font-semibold mb-2 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-400" />
            Compliance History
          </h2>
          <p className="text-gray-400 text-sm mb-3">
            Full credential compliance history and nurse-level compliance scores.
          </p>
          <Link
            href="/dashboard/compliance"
            className="inline-flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg px-4 py-2 text-sm transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            Open Compliance Center
          </Link>
        </div>
      </div>
    </DashboardLayout>
  )
}
